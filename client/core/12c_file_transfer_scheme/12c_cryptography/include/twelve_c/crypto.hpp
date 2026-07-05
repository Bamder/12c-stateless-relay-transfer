#pragma once

#include "twelve_c/types.hpp"

#include <string>
#include <string_view>

namespace twelve_c {

CredentialParts split_credential(std::string_view credential);

Bytes slow_kdf(std::string_view key_code, std::string_view salt);

Bytes generate_fek();

Bytes random_bytes(std::size_t length);

Bytes encrypt(const Bytes& key, const Bytes& plaintext);

Bytes decrypt(const Bytes& key, const Bytes& packed_ciphertext);

std::string derive_upload_token(
    std::string_view search_code,
    std::string_view salt_fix_search,
    std::uint32_t index);

Bytes sha256(const Bytes& data);

}  // namespace twelve_c
