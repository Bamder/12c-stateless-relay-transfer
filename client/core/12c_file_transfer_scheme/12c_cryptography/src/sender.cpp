#include "twelve_c/sender.hpp"

#include "twelve_c/constants.hpp"
#include "twelve_c/crypto.hpp"
#include "twelve_c/merkle.hpp"
#include "twelve_c/smb.hpp"
#include "twelve_c/wire_layout.hpp"

#include <stdexcept>
#include <vector>

namespace twelve_c {
namespace {

std::vector<Bytes> split_ciphertext(
    const Bytes& ciphertext,
    const WireLayout& layout) {
    const std::size_t wire_block_size = layout.wire_block_size;
    const std::uint32_t num_tokens = layout.num_tokens;

    if (num_tokens == 0) {
        throw std::runtime_error("wire layout requires at least one token");
    }

    std::vector<Bytes> blocks;
    blocks.resize(num_tokens);

    for (std::uint32_t index = 1; index < num_tokens; ++index) {
        const std::size_t offset =
            static_cast<std::size_t>(index - 1) * wire_block_size;
        blocks[index - 1].assign(
            ciphertext.begin() + static_cast<std::ptrdiff_t>(offset),
            ciphertext.begin() + static_cast<std::ptrdiff_t>(offset + wire_block_size));
    }

    const std::size_t last_offset =
        static_cast<std::size_t>(num_tokens - 1) * wire_block_size;
    blocks[num_tokens - 1].assign(
        ciphertext.begin() + static_cast<std::ptrdiff_t>(last_offset),
        ciphertext.end());

    return blocks;
}

Bytes build_token0(const Bytes& s_enc, const Bytes& last_block) {
    Bytes token0;
    token0.reserve(s_enc.size() + last_block.size());
    token0.insert(token0.end(), s_enc.begin(), s_enc.end());
    token0.insert(token0.end(), last_block.begin(), last_block.end());
    return token0;
}

UploadMap build_upload_map(
    const Bytes& token0,
    const std::vector<Bytes>& leading_blocks,
    const std::string& search_code) {
    UploadMap upload_map;
    const std::uint32_t num_tokens =
        static_cast<std::uint32_t>(leading_blocks.size() + 1);

    for (std::uint32_t index = 0; index < num_tokens; ++index) {
        const std::string token = derive_upload_token(
            search_code,
            kSaltFixSearch,
            index);
        if (index == 0) {
            upload_map.emplace(token, token0);
        } else {
            upload_map.emplace(
                token,
                leading_blocks[static_cast<std::size_t>(index - 1)]);
        }
    }

    return upload_map;
}

}  // namespace

UploadMap prepare_upload(
    const Bytes& file_plaintext,
    const std::string& credential,
    const std::string& original_file_name) {
    const CredentialParts parts = split_credential(credential);
    const WireLayout layout = compute_wire_layout(file_plaintext.size());

    Bytes plaintext = file_plaintext;
    if (layout.plaintext_padding > 0) {
        // 前缀零填充：加密后落在密文前段 → Token[1..]；避免 Token[0] 末段掺入 padding
        Bytes padded;
        padded.assign(layout.plaintext_padding, 0);
        padded.insert(padded.end(), file_plaintext.begin(), file_plaintext.end());
        plaintext = std::move(padded);
    }

    const Bytes k_smb = slow_kdf(parts.key_code, kSaltFixKey);
    const Bytes salt_rand = random_bytes(kSaltRandBytes);
    const Bytes k_kek = slow_kdf(parts.key_code, std::string(
        reinterpret_cast<const char*>(salt_rand.data()),
        salt_rand.size()));
    const Bytes k_fek = generate_fek();

    const Bytes ciphertext = encrypt(k_fek, plaintext);
    if (ciphertext.size() != layout.ciphertext_length) {
        throw std::runtime_error("ciphertext length mismatch after encryption");
    }

    const std::vector<Bytes> data_blocks = split_ciphertext(ciphertext, layout);
    const MerkleTree merkle_tree = build_merkle_tree(data_blocks);
    const Bytes encrypted_fek = encrypt(k_kek, k_fek);

    SmbMetadata metadata;
    metadata.root_hash = merkle_tree.root_hash;
    metadata.encrypted_fek = EncryptedBlob::unpack(encrypted_fek);
    metadata.salt_rand = std::move(salt_rand);
    metadata.merkle_tree = std::move(merkle_tree);
    metadata.num_tokens = layout.num_tokens;
    metadata.wire_block_size = layout.wire_block_size;
    metadata.ciphertext_length = layout.ciphertext_length;
    metadata.original_file_length = file_plaintext.size();
    metadata.original_file_name = normalize_original_file_name(original_file_name);

    const Bytes sm_bytes = serialize_smb(metadata);
    if (sm_bytes.size() != kSmPlainBytes) {
        throw std::runtime_error("SMB plaintext size mismatch");
    }
    const Bytes s_enc = encrypt(k_smb, sm_bytes);
    if (s_enc.size() != kSmEncBytes) {
        throw std::runtime_error("SMB encrypted size mismatch");
    }

    const Bytes& last_block = data_blocks.back();
    if (last_block.size() != layout.last_block_length) {
        throw std::runtime_error("last ciphertext block length mismatch");
    }

    const Bytes token0 = build_token0(s_enc, last_block);
    if (token0.size() != layout.wire_block_size) {
        throw std::runtime_error("token0 wire size mismatch");
    }

    std::vector<Bytes> leading_blocks;
    if (data_blocks.size() > 1) {
        leading_blocks.assign(data_blocks.begin(), data_blocks.end() - 1);
    }

    return build_upload_map(token0, leading_blocks, parts.search_code);
}

}  // namespace twelve_c
