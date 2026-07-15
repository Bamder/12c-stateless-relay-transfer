#include "twelve_c/upload_prepare_session.hpp"

#include "twelve_c/constants.hpp"
#include "twelve_c/crypto.hpp"
#include "twelve_c/merkle.hpp"
#include "twelve_c/segment.hpp"
#include "twelve_c/smb.hpp"

#include <stdexcept>

namespace twelve_c {
namespace {

std::string normalize_file_name_for_segment_code(
    const std::string& original_file_name,
    const std::uint16_t segment_code) {
    std::string normalized = normalize_original_file_name(original_file_name);
    if (is_v21_segmented_mode(segment_code) &&
        normalized.size() > kV21FileNamePayloadBytes) {
        normalized.resize(kV21FileNamePayloadBytes);
        while (!normalized.empty() &&
               (static_cast<unsigned char>(normalized.back()) & 0xC0) == 0x80) {
            normalized.pop_back();
        }
    }
    return normalized;
}

}  // namespace

UploadPrepareSession::UploadPrepareSession(
    std::string credential,
    std::string original_file_name,
    const std::size_t file_plaintext_size,
    const std::uint16_t segment_code,
    const std::size_t max_wire_block_bytes)
    : credential_parts_(split_credential(credential)),
      segment_code_(segment_code),
      original_file_name_(std::move(original_file_name)),
      original_file_size_(file_plaintext_size) {
    validate_segment_code_v21(segment_code_);
    layout_ = compute_wire_layout(
        file_plaintext_size,
        segment_code_,
        max_wire_block_bytes);
    padding_remaining_ = layout_.plaintext_padding;

    if (is_v2_whole_file_mode(segment_code_)) {
        segment_plaintext_bytes_ =
            file_plaintext_size + layout_.plaintext_padding;
    } else {
        segment_plaintext_bytes_ = decode_segment_plaintext_bytes_v21(segment_code_);
    }

    k_smb_ = slow_kdf(credential_parts_.key_code, kSaltFixKey);
    salt_rand_ = random_bytes(kSaltRandBytes);
    k_kek_ = slow_kdf(
        credential_parts_.key_code,
        std::string(
            reinterpret_cast<const char*>(salt_rand_.data()),
            salt_rand_.size()));
    k_fek_ = generate_fek();

    segment_buffer_.reserve(
        std::min(segment_plaintext_bytes_, std::size_t{1024 * 1024}));
}

void UploadPrepareSession::append_plaintext_bytes(
    const std::uint8_t* data,
    const std::size_t length) {
    if (finalized_) {
        throw std::runtime_error("upload prepare session already finalized");
    }
    if (length == 0) {
        return;
    }

    std::size_t offset = 0;
    while (offset < length) {
        const std::size_t segment_limit = segment_plaintext_bytes_;
        if (segment_buffer_.size() >= segment_limit) {
            flush_segment_buffer_if_ready(false);
        }

        const std::size_t space = segment_limit - segment_buffer_.size();
        const std::size_t take = std::min(length - offset, space);
        if (take == 0) {
            flush_segment_buffer_if_ready(false);
            continue;
        }

        segment_buffer_.insert(
            segment_buffer_.end(),
            data + offset,
            data + offset + take);
        offset += take;

        if (segment_buffer_.size() >= segment_limit) {
            flush_segment_buffer_if_ready(false);
        }
    }
}

void UploadPrepareSession::append_padding_zeros(std::size_t count) {
    if (finalized_) {
        throw std::runtime_error("upload prepare session already finalized");
    }
    while (count > 0) {
        const std::size_t segment_limit = segment_plaintext_bytes_;
        if (segment_buffer_.size() >= segment_limit) {
            flush_segment_buffer_if_ready(false);
        }

        const std::size_t space = segment_limit - segment_buffer_.size();
        const std::size_t take = std::min(count, space);
        if (take == 0) {
            flush_segment_buffer_if_ready(false);
            continue;
        }

        segment_buffer_.insert(segment_buffer_.end(), take, 0);
        count -= take;

        if (segment_buffer_.size() >= segment_limit) {
            flush_segment_buffer_if_ready(false);
        }
    }
}

void UploadPrepareSession::flush_segment_buffer_if_ready(const bool force) {
    while (!segment_buffer_.empty()) {
        const std::size_t segment_limit = segment_plaintext_bytes_;

        if (!force && segment_buffer_.size() < segment_limit) {
            return;
        }

        const std::size_t take = force
            ? segment_buffer_.size()
            : segment_limit;
        if (take == 0) {
            return;
        }

        const Bytes segment_plaintext(
            segment_buffer_.begin(),
            segment_buffer_.begin() + static_cast<std::ptrdiff_t>(take));
        segment_buffer_.erase(
            segment_buffer_.begin(),
            segment_buffer_.begin() + static_cast<std::ptrdiff_t>(take));

        const Bytes segment_pack = encrypt(k_fek_, segment_plaintext);
        append_ciphertext_pack(segment_pack);

        if (!force) {
            return;
        }
    }
}

void UploadPrepareSession::append_ciphertext_pack(const Bytes& pack) {
    wire_pending_.insert(wire_pending_.end(), pack.begin(), pack.end());
    try_emit_leading_blocks();
}

void UploadPrepareSession::try_emit_leading_blocks() {
    const std::size_t leading_target =
        static_cast<std::size_t>(layout_.num_tokens - 1);
    const std::size_t wire_block_size = layout_.wire_block_size;

    while (emitted_leading_count_ < leading_target &&
           wire_pending_.size() >= wire_block_size) {
        Bytes block(
            wire_pending_.begin(),
            wire_pending_.begin() + static_cast<std::ptrdiff_t>(wire_block_size));
        wire_pending_.erase(
            wire_pending_.begin(),
            wire_pending_.begin() + static_cast<std::ptrdiff_t>(wire_block_size));

        leaf_hashes_.push_back(hash_block(block));

        const std::uint32_t token_index =
            static_cast<std::uint32_t>(emitted_leading_count_ + 1);
        ready_blocks_.push_back(UploadWireBlock{
            derive_upload_token(
                credential_parts_.search_code,
                kSaltFixSearch,
                token_index),
            std::move(block),
        });
        emitted_leading_count_++;
    }
}

void UploadPrepareSession::feed(const Bytes& chunk) {
    if (finalized_) {
        throw std::runtime_error("upload prepare session already finalized");
    }
    if (file_bytes_fed_ + chunk.size() > original_file_size_) {
        throw std::runtime_error("upload prepare feed exceeds file size");
    }

    // 与 sender.cpp 一致：wire 对齐用前缀零填充，必须先于文件明文进入密文流。
    while (padding_remaining_ > 0) {
        const std::size_t pad_batch =
            std::min(padding_remaining_, std::size_t{64 * 1024});
        append_padding_zeros(pad_batch);
        padding_remaining_ -= pad_batch;
    }

    if (!chunk.empty()) {
        append_plaintext_bytes(chunk.data(), chunk.size());
    }

    file_bytes_fed_ += chunk.size();

    if (is_feed_complete()) {
        flush_segment_buffer_if_ready(true);
    }
}

std::vector<UploadWireBlock> UploadPrepareSession::take_ready_blocks() {
    std::vector<UploadWireBlock> blocks;
    blocks.swap(ready_blocks_);
    return blocks;
}

UploadWireBlock UploadPrepareSession::finalize() {
    if (finalized_) {
        throw std::runtime_error("upload prepare session already finalized");
    }
    if (!is_feed_complete()) {
        throw std::runtime_error("upload prepare feed incomplete");
    }
    if (padding_remaining_ != 0) {
        throw std::runtime_error("upload prepare padding incomplete");
    }
    if (!segment_buffer_.empty()) {
        throw std::runtime_error("upload prepare segment buffer not flushed");
    }

    const std::size_t leading_target =
        static_cast<std::size_t>(layout_.num_tokens - 1);
    if (emitted_leading_count_ != leading_target) {
        throw std::runtime_error("upload prepare leading block count mismatch");
    }
    if (wire_pending_.size() != layout_.last_block_length) {
        throw std::runtime_error("upload prepare last block length mismatch");
    }

    MerkleTree merkle_tree;
    {
        std::vector<Bytes> leaves = leaf_hashes_;
        const Bytes last_block = wire_pending_;
        leaves.push_back(hash_block(last_block));
        merkle_tree = build_merkle_tree_from_leaf_hashes(std::move(leaves));
    }

    const Bytes encrypted_fek = encrypt(k_kek_, k_fek_);

    SmbMetadata metadata;
    metadata.root_hash = merkle_tree.root_hash;
    metadata.encrypted_fek = EncryptedBlob::unpack(encrypted_fek);
    metadata.salt_rand = std::move(salt_rand_);
    metadata.merkle_tree = std::move(merkle_tree);
    metadata.num_tokens = layout_.num_tokens;
    metadata.wire_block_size = layout_.wire_block_size;
    metadata.ciphertext_length = layout_.ciphertext_length;
    metadata.original_file_length = original_file_size_;
    metadata.segment_code = segment_code_;
    metadata.original_file_name = normalize_file_name_for_segment_code(
        original_file_name_,
        segment_code_);

    const Bytes sm_bytes = serialize_smb(metadata);
    if (sm_bytes.size() != kSmPlainBytes) {
        throw std::runtime_error("SMB plaintext size mismatch");
    }

    const Bytes s_enc = encrypt(k_smb_, sm_bytes);
    if (s_enc.size() != kSmEncBytes) {
        throw std::runtime_error("SMB encrypted size mismatch");
    }

    Bytes token0;
    token0.reserve(s_enc.size() + wire_pending_.size());
    token0.insert(token0.end(), s_enc.begin(), s_enc.end());
    token0.insert(token0.end(), wire_pending_.begin(), wire_pending_.end());
    wire_pending_.clear();

    if (token0.size() != layout_.wire_block_size) {
        throw std::runtime_error("token0 wire size mismatch");
    }

    finalized_ = true;
    return UploadWireBlock{
        derive_upload_token(
            credential_parts_.search_code,
            kSaltFixSearch,
            0),
        std::move(token0),
    };
}

}  // namespace twelve_c
