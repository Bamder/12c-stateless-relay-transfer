#pragma once

#include <cstdint>
#include <map>
#include <string>
#include <vector>

namespace twelve_c {

using Bytes = std::vector<std::uint8_t>;
using UploadMap = std::map<std::string, Bytes>;

struct CredentialParts {
    std::string search_code;
    std::string key_code;
};

struct EncryptedBlob {
    Bytes nonce;
    Bytes ciphertext;
    Bytes tag;

    Bytes pack() const;
    static EncryptedBlob unpack(const Bytes& packed);
};

struct MerkleTree {
    std::vector<std::vector<Bytes>> levels;
    Bytes root_hash;
};

struct SmbMetadata {
    Bytes root_hash;
    EncryptedBlob encrypted_fek;
    Bytes salt_rand;
    MerkleTree merkle_tree;
    std::uint32_t num_tokens = 0;
    std::uint32_t wire_block_size = 0;
    std::uint64_t ciphertext_length = 0;
    std::uint64_t original_file_length = 0;
    std::string original_file_name;
};

}  // namespace twelve_c
