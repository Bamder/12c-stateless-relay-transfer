#include "twelve_c/receive_decrypt_session.hpp"

#include "twelve_c/constants.hpp"
#include "twelve_c/crypto.hpp"
#include "twelve_c/merkle.hpp"
#include "twelve_c/segment.hpp"
#include "twelve_c/smb_parser.hpp"

#include <algorithm>
#include <stdexcept>


namespace twelve_c {

ReceiveDecryptSession::ReceiveDecryptSession(
    std::string credential,
    const Bytes& token0_wire)
    : credential_parts_(split_credential(credential)),
      metadata_(parse_smb_encrypted(credential, token0_wire)),
      token0_wire_(token0_wire) {
    if (metadata_.num_tokens == 0) {
        throw std::runtime_error("receive decrypt session: num_tokens is zero");
    }

    wire_block_size_ = metadata_.wire_block_size;
    if (token0_wire_.size() != wire_block_size_) {
        throw std::runtime_error("receive decrypt session: token0 wire size mismatch");
    }

    const std::size_t ciphertext_length =
        static_cast<std::size_t>(metadata_.ciphertext_length);
    last_block_length_ =
        ciphertext_length -
        static_cast<std::size_t>(metadata_.num_tokens - 1) * wire_block_size_;

    if (kSmEncBytes + last_block_length_ != wire_block_size_) {
        throw std::runtime_error("receive decrypt session: token0 layout invalid");
    }

    padded_plaintext_length_ = padded_plaintext_length_from_ciphertext(
        ciphertext_length,
        metadata_.segment_code);
    original_file_length_ =
        static_cast<std::size_t>(metadata_.original_file_length);
    if (padded_plaintext_length_ < original_file_length_) {
        throw std::runtime_error("ciphertext length smaller than original file");
    }

    leaf_hashes_.resize(metadata_.num_tokens);

    if (is_v21_segmented_mode(metadata_.segment_code)) {
        segment_plaintext_bytes_ =
            decode_segment_plaintext_bytes_v21(metadata_.segment_code);
        remaining_plaintext_ = padded_plaintext_length_;
        prefix_skip_remaining_ =
            padded_plaintext_length_ - original_file_length_;
    }
}

void ReceiveDecryptSession::enqueue_plaintext(Bytes chunk) {
    produced_plaintext_bytes_ += chunk.size();
    ready_plaintext_parts_.push_back(std::move(chunk));
}

std::size_t ReceiveDecryptSession::ready_plaintext_available() const {
    if (ready_plaintext_parts_.empty()) {
        return 0;
    }

    std::size_t total = 0;
    for (std::size_t index = 0; index < ready_plaintext_parts_.size(); ++index) {
        const Bytes& part = ready_plaintext_parts_[index];
        if (index == 0) {
            if (part.size() > ready_plaintext_offset_) {
                total += part.size() - ready_plaintext_offset_;
            }
        } else {
            total += part.size();
        }
    }
    return total;
}

std::size_t ReceiveDecryptSession::ready_file_bytes_available() const {
    const std::size_t padded_available = ready_plaintext_available();
    if (padded_available <= prefix_skip_remaining_) {
        return 0;
    }
    return padded_available - prefix_skip_remaining_;
}

void ReceiveDecryptSession::advance_ready_front(const std::size_t byte_count) {
    if (byte_count == 0) {
        return;
    }

    consumed_padded_bytes_ += byte_count;
    ready_plaintext_offset_ += byte_count;

    while (!ready_plaintext_parts_.empty() &&
           ready_plaintext_offset_ >= ready_plaintext_parts_.front().size()) {
        ready_plaintext_offset_ -= ready_plaintext_parts_.front().size();
        ready_plaintext_parts_.pop_front();
    }
}

Bytes ReceiveDecryptSession::drain_ready_queue(const std::size_t max_output_bytes) {
    if (max_output_bytes == 0) {
        return {};
    }

    Bytes output;
    output.reserve(std::min(max_output_bytes, ready_file_bytes_available()));

    while (output.size() < max_output_bytes && !ready_plaintext_parts_.empty()) {
        const Bytes& front = ready_plaintext_parts_.front();
        const std::size_t front_available =
            front.size() > ready_plaintext_offset_
                ? front.size() - ready_plaintext_offset_
                : 0;
        if (front_available == 0) {
            ready_plaintext_parts_.pop_front();
            ready_plaintext_offset_ = 0;
            continue;
        }

        if (prefix_skip_remaining_ > 0) {
            const std::size_t skip =
                std::min(front_available, prefix_skip_remaining_);
            advance_ready_front(skip);
            prefix_skip_remaining_ -= skip;
            continue;
        }

        const std::size_t output_room = max_output_bytes - output.size();
        const std::size_t take = std::min(front_available, output_room);
        output.insert(
            output.end(),
            front.begin() + static_cast<std::ptrdiff_t>(ready_plaintext_offset_),
            front.begin() +
                static_cast<std::ptrdiff_t>(ready_plaintext_offset_ + take));
        advance_ready_front(take);
    }

    exported_file_bytes_ += output.size();
    return output;
}

Bytes ReceiveDecryptSession::drain_plaintext_buffer(const std::size_t max_bytes) {
    if (max_bytes == 0 || plaintext_padded_.empty()) {
        return {};
    }

    const std::size_t chunk_size =
        std::min(max_bytes, plaintext_padded_.size());
    Bytes chunk(
        plaintext_padded_.begin(),
        plaintext_padded_.begin() + static_cast<std::ptrdiff_t>(chunk_size));
    plaintext_padded_.erase(
        plaintext_padded_.begin(),
        plaintext_padded_.begin() + static_cast<std::ptrdiff_t>(chunk_size));
    if (plaintext_padded_.empty()) {
        plaintext_padded_.shrink_to_fit();
    }
    return chunk;
}

void ReceiveDecryptSession::feed_ciphertext(
    const std::uint8_t* data,
    const std::size_t length) {
    if (length == 0) {
        return;
    }
    if (!is_v21_segmented_mode(metadata_.segment_code)) {
        ciphertext_pack_buffer_.insert(
            ciphertext_pack_buffer_.end(),
            data,
            data + length);
        return;
    }

    std::size_t offset = 0;
    while (offset < length) {
        const std::size_t segment_plain_length = std::min(
            segment_plaintext_bytes_,
            remaining_plaintext_);
        const std::size_t segment_pack_length =
            segment_plain_length + kGcmEnvelopeBytes;

        while (ciphertext_pack_buffer_.size() < segment_pack_length &&
               offset < length) {
            ciphertext_pack_buffer_.push_back(data[offset++]);
        }

        if (ciphertext_pack_buffer_.size() < segment_pack_length) {
            return;
        }

        if (!k_fek_ready_) {
            const Bytes k_kek = slow_kdf(
                credential_parts_.key_code,
                std::string(
                    reinterpret_cast<const char*>(metadata_.salt_rand.data()),
                    metadata_.salt_rand.size()));
            k_fek_ = decrypt(k_kek, metadata_.encrypted_fek.pack());
            k_fek_ready_ = true;
        }

        Bytes segment_plain = decrypt(k_fek_, ciphertext_pack_buffer_);
        if (segment_plain.size() != segment_plain_length) {
            throw std::runtime_error(
                "receive decrypt session: V2.1 segment plaintext length mismatch");
        }

        enqueue_plaintext(std::move(segment_plain));
        ciphertext_pack_buffer_.clear();
        remaining_plaintext_ -= segment_plain_length;
    }
}

void ReceiveDecryptSession::add_wire_token(
    const std::uint32_t token_index,
    const Bytes& wire_data) {
    if (finalized_) {
        throw std::runtime_error("receive decrypt session already finalized");
    }
    if (token_index != next_token_index_) {
        throw std::runtime_error(
            "receive decrypt session: out-of-order wire token index");
    }
    if (token_index == 0 || token_index >= metadata_.num_tokens) {
        throw std::runtime_error("receive decrypt session: invalid wire token index");
    }
    if (wire_data.size() != wire_block_size_) {
        throw std::runtime_error("receive decrypt session: wire block size mismatch");
    }

    leaf_hashes_[token_index - 1] = sha256(wire_data);
    feed_ciphertext(wire_data.data(), wire_data.size());
    next_token_index_++;
}

void ReceiveDecryptSession::feed_last_logical_block() {
    if (last_block_length_ == 0) {
        return;
    }
    const auto begin = token0_wire_.begin() + static_cast<std::ptrdiff_t>(kSmEncBytes);
    const auto end = begin + static_cast<std::ptrdiff_t>(last_block_length_);
    leaf_hashes_[metadata_.num_tokens - 1] = sha256(Bytes(begin, end));
    feed_ciphertext(
        token0_wire_.data() + kSmEncBytes,
        last_block_length_);
    token0_wire_.clear();
    token0_wire_.shrink_to_fit();
}

void ReceiveDecryptSession::complete_finalize() {
    if (finalized_) {
        throw std::runtime_error("receive decrypt session already finalized");
    }

    if (next_token_index_ != metadata_.num_tokens) {
        throw std::runtime_error("receive decrypt session: missing wire tokens");
    }

    feed_last_logical_block();

    if (!verify_merkle_root_from_leaf_hashes(
            leaf_hashes_,
            metadata_.root_hash)) {
        throw std::runtime_error("merkle root verification failed");
    }

    leaf_hashes_.clear();
    leaf_hashes_.shrink_to_fit();

    if (is_v2_whole_file_mode(metadata_.segment_code)) {
        if (!k_fek_ready_) {
            const Bytes k_kek = slow_kdf(
                credential_parts_.key_code,
                std::string(
                    reinterpret_cast<const char*>(metadata_.salt_rand.data()),
                    metadata_.salt_rand.size()));
            k_fek_ = decrypt(k_kek, metadata_.encrypted_fek.pack());
            k_fek_ready_ = true;
        }

        plaintext_padded_ = decrypt_payload_v2_whole_file(
            k_fek_,
            ciphertext_pack_buffer_,
            padded_plaintext_length_);
        ciphertext_pack_buffer_.clear();
        ciphertext_pack_buffer_.shrink_to_fit();

        const std::size_t prefix_padding =
            padded_plaintext_length_ - original_file_length_;
        if (prefix_padding > 0) {
            plaintext_padded_.erase(
                plaintext_padded_.begin(),
                plaintext_padded_.begin() +
                    static_cast<std::ptrdiff_t>(prefix_padding));
        }
        if (plaintext_padded_.size() != original_file_length_) {
            throw std::runtime_error("decrypted plaintext shorter than expected");
        }
    } else {
        if (!ciphertext_pack_buffer_.empty() || remaining_plaintext_ != 0) {
            throw std::runtime_error(
                "receive decrypt session: incomplete V2.1 ciphertext stream");
        }
        if (produced_plaintext_bytes_ != padded_plaintext_length_) {
            throw std::runtime_error(
                "receive decrypt session: decrypted plaintext length mismatch");
        }
        if (consumed_padded_bytes_ + ready_plaintext_available() !=
            produced_plaintext_bytes_) {
            throw std::runtime_error(
                "receive decrypt session: padded plaintext accounting mismatch");
        }
        if (exported_file_bytes_ + ready_file_bytes_available() !=
            original_file_length_) {
            throw std::runtime_error(
                "receive decrypt session: file plaintext accounting mismatch");
        }
        ciphertext_pack_buffer_.clear();
        ciphertext_pack_buffer_.shrink_to_fit();
    }

    finalized_ = true;
}

std::size_t ReceiveDecryptSession::plaintext_byte_length() const {
    if (is_v21_segmented_mode(metadata_.segment_code)) {
        return ready_file_bytes_available();
    }
    if (!finalized_) {
        throw std::runtime_error(
            "receive decrypt session: finalize not completed");
    }
    return plaintext_padded_.size();
}

std::size_t ReceiveDecryptSession::padded_plaintext_length() const {
    return padded_plaintext_length_;
}

std::size_t ReceiveDecryptSession::original_file_length() const {
    return original_file_length_;
}

Bytes ReceiveDecryptSession::take_plaintext_chunk(const std::size_t max_bytes) {
    if (is_v21_segmented_mode(metadata_.segment_code)) {
        return drain_ready_queue(max_bytes);
    }
    if (!finalized_) {
        throw std::runtime_error(
            "receive decrypt session: finalize not completed");
    }
    return drain_plaintext_buffer(max_bytes);
}

Bytes ReceiveDecryptSession::finalize() {
    complete_finalize();

    Bytes output;
    output.reserve(original_file_length_);
    while (true) {
        const std::size_t remaining =
            is_v21_segmented_mode(metadata_.segment_code)
                ? ready_file_bytes_available()
                : plaintext_padded_.size();
        if (remaining == 0) {
            break;
        }

        Bytes chunk = take_plaintext_chunk(
            std::max<std::size_t>(remaining, 1));
        if (chunk.empty()) {
            break;
        }
        output.insert(output.end(), chunk.begin(), chunk.end());
    }

    if (output.size() != original_file_length_) {
        throw std::runtime_error("decrypted plaintext shorter than expected");
    }
    return output;
}

}  // namespace twelve_c
