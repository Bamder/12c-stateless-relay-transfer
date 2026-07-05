#include "twelve_c/receiver.hpp"

#include "twelve_c/constants.hpp"
#include "twelve_c/crypto.hpp"
#include "twelve_c/merkle.hpp"
#include "twelve_c/smb_parser.hpp"

#include <stdexcept>
#include <vector>

namespace twelve_c {
namespace {

std::string make_token(
    const std::string& search_code,
    const std::uint32_t index) {
    return derive_upload_token(search_code, kSaltFixSearch, index);
}

const Bytes& lookup_upload(
    const UploadMap& uploads,
    const std::string& key) {
    const auto iterator = uploads.find(key);
    if (iterator == uploads.end()) {
        throw std::runtime_error("upload entry not found: " + key);
    }
    return iterator->second;
}

Bytes concatenate_blocks(const std::vector<Bytes>& blocks) {
    std::size_t total_size = 0;
    for (const auto& block : blocks) {
        total_size += block.size();
    }

    Bytes ciphertext;
    ciphertext.reserve(total_size);
    for (const auto& block : blocks) {
        ciphertext.insert(ciphertext.end(), block.begin(), block.end());
    }
    return ciphertext;
}

std::vector<Bytes> collect_blocks_from_uploads(
    const UploadMap& uploads,
    const std::string& search_code,
    const SmbMetadata& metadata) {
    const std::uint32_t num_tokens = metadata.num_tokens;
    if (num_tokens == 0) {
        return {};
    }

    const std::size_t wire_block_size = metadata.wire_block_size;
    const std::size_t ciphertext_length =
        static_cast<std::size_t>(metadata.ciphertext_length);
    const std::size_t last_block_length =
        ciphertext_length - static_cast<std::size_t>(num_tokens - 1) * wire_block_size;

    const Bytes& token0 = lookup_upload(uploads, make_token(search_code, 0));
    if (token0.size() != wire_block_size) {
        throw std::runtime_error("token0 wire size mismatch");
    }

    if (kSmEncBytes + last_block_length != wire_block_size) {
        throw std::runtime_error("token0 layout invalid");
    }

    std::vector<Bytes> blocks;
    blocks.resize(num_tokens);

    for (std::uint32_t token_index = 1; token_index < num_tokens; ++token_index) {
        const Bytes& block_cipher = lookup_upload(
            uploads,
            make_token(search_code, token_index));
        if (block_cipher.size() != wire_block_size) {
            throw std::runtime_error(
                "data token wire size mismatch at index " +
                std::to_string(token_index));
        }
        blocks[token_index - 1] = block_cipher;
    }

    blocks[num_tokens - 1].assign(
        token0.begin() + static_cast<std::ptrdiff_t>(kSmEncBytes),
        token0.begin() + static_cast<std::ptrdiff_t>(kSmEncBytes + last_block_length));

    if (!verify_merkle_root(blocks, metadata.root_hash)) {
        throw std::runtime_error("merkle root verification failed");
    }

    return blocks;
}

Bytes decrypt_file(
    const CredentialParts& parts,
    const SmbMetadata& metadata,
    const std::vector<Bytes>& blocks) {
    const Bytes ciphertext = concatenate_blocks(blocks);
    if (ciphertext.size() != static_cast<std::size_t>(metadata.ciphertext_length)) {
        throw std::runtime_error("reassembled ciphertext length mismatch");
    }

    const Bytes k_kek = slow_kdf(
        parts.key_code,
        std::string(
            reinterpret_cast<const char*>(metadata.salt_rand.data()),
            metadata.salt_rand.size()));
    const Bytes k_fek = decrypt(k_kek, metadata.encrypted_fek.pack());
    Bytes plaintext = decrypt(k_fek, ciphertext);

    const std::size_t padded_plaintext_length =
        static_cast<std::size_t>(metadata.ciphertext_length) - kGcmEnvelopeBytes;
    const std::size_t original_length =
        static_cast<std::size_t>(metadata.original_file_length);
    if (padded_plaintext_length < original_length) {
        throw std::runtime_error("ciphertext length smaller than original file");
    }
    const std::size_t prefix_padding = padded_plaintext_length - original_length;

    if (plaintext.size() != padded_plaintext_length) {
        throw std::runtime_error("decrypted plaintext length mismatch");
    }
    if (prefix_padding > 0) {
        plaintext.erase(
            plaintext.begin(),
            plaintext.begin() + static_cast<std::ptrdiff_t>(prefix_padding));
    }
    if (plaintext.size() != original_length) {
        throw std::runtime_error("decrypted plaintext shorter than expected");
    }
    return plaintext;
}

}  // namespace

Bytes receive_from_upload_map(
    const std::string& credential,
    const UploadMap& uploads) {
    const CredentialParts parts = split_credential(credential);

    const std::string token0_key = make_token(parts.search_code, 0);
    const Bytes& token0_wire = lookup_upload(uploads, token0_key);
    const SmbMetadata metadata = parse_smb_encrypted(credential, token0_wire);

    const std::vector<Bytes> blocks = collect_blocks_from_uploads(
        uploads,
        parts.search_code,
        metadata);

    return decrypt_file(parts, metadata, blocks);
}

}  // namespace twelve_c
