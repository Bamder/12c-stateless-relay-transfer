#include "twelve_c/smb_parser.hpp"

#include "twelve_c/constants.hpp"
#include "twelve_c/crypto.hpp"
#include "twelve_c/smb.hpp"
#include "twelve_c/wire_layout.hpp"

#include <stdexcept>

namespace twelve_c {

namespace {

Bytes extract_s_enc(const Bytes& token0_wire) {
    if (token0_wire.size() < kSmEncBytes) {
        throw std::runtime_error("token0 shorter than encrypted SMB");
    }

    return Bytes(token0_wire.begin(), token0_wire.begin() + static_cast<std::ptrdiff_t>(kSmEncBytes));
}

}  // namespace

SmbMetadata parse_smb_encrypted(
    const std::string& credential,
    const Bytes& token0_wire) {
    const CredentialParts parts = split_credential(credential);
    const Bytes k_smb = slow_kdf(parts.key_code, kSaltFixKey);
    const Bytes s_enc = extract_s_enc(token0_wire);

    try {
        const Bytes sm_bytes = decrypt(k_smb, s_enc);
        return deserialize_smb(sm_bytes);
    } catch (const std::exception& ex) {
        throw std::runtime_error(
            std::string("SMB integrity check failed: ") + ex.what());
    }
}

}  // namespace twelve_c
