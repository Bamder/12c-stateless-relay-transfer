#include "twelve_c/crypto.hpp"

#include "twelve_c/constants.hpp"

#include <openssl/evp.h>
#include <openssl/hmac.h>
#include <openssl/rand.h>

#include <algorithm>
#include <array>
#include <iomanip>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>

namespace twelve_c {
namespace {

void ensure_hmac(unsigned char* result, const char* message) {
    if (result == nullptr) {
        throw std::runtime_error(message);
    }
}

void ensure_openssl(std::int32_t result, const char* message) {
    if (result != 1) {
        throw std::runtime_error(message);
    }
}

Bytes derive_hkdf(
    const Bytes& ikm,
    const std::string& salt,
    const std::string& info,
    std::size_t length) {
    const Bytes prk = [&]() {
        if (salt.empty()) {
            Bytes zero_salt(kHashBytes, 0);
            unsigned int len = 0;
            Bytes out(kHashBytes);
            ensure_hmac(
                HMAC(
                    EVP_sha256(),
                    zero_salt.data(),
                    static_cast<int>(zero_salt.size()),
                    ikm.data(),
                    ikm.size(),
                    out.data(),
                    &len),
                "HKDF extract failed");
            out.resize(len);
            return out;
        }

        unsigned int len = 0;
        Bytes out(kHashBytes);
        ensure_hmac(
            HMAC(
                EVP_sha256(),
                salt.data(),
                static_cast<int>(salt.size()),
                ikm.data(),
                ikm.size(),
                out.data(),
                &len),
            "HKDF extract failed");
        out.resize(len);
        return out;
    }();

    Bytes output;
    output.reserve(length);

    Bytes previous;
    std::uint8_t counter = 1;
    while (output.size() < length) {
        Bytes expand_input;
        expand_input.insert(expand_input.end(), previous.begin(), previous.end());
        expand_input.insert(expand_input.end(), info.begin(), info.end());
        expand_input.push_back(counter);

        unsigned int len = 0;
        Bytes block(kHashBytes);
        ensure_hmac(
            HMAC(
                EVP_sha256(),
                prk.data(),
                static_cast<int>(prk.size()),
                expand_input.data(),
                expand_input.size(),
                block.data(),
                &len),
            "HKDF expand failed");
        block.resize(len);
        previous = block;

        const std::size_t remaining = length - output.size();
        output.insert(
            output.end(),
            block.begin(),
            block.begin() + static_cast<std::ptrdiff_t>(std::min(remaining, block.size())));
        ++counter;
    }

    return output;
}

}  // namespace

Bytes EncryptedBlob::pack() const {
    Bytes packed;
    packed.reserve(nonce.size() + tag.size() + ciphertext.size());
    packed.insert(packed.end(), nonce.begin(), nonce.end());
    packed.insert(packed.end(), tag.begin(), tag.end());
    packed.insert(packed.end(), ciphertext.begin(), ciphertext.end());
    return packed;
}

EncryptedBlob EncryptedBlob::unpack(const Bytes& packed) {
    if (packed.size() < kGcmNonceBytes + kGcmTagBytes) {
        throw std::runtime_error("encrypted blob too short");
    }

    EncryptedBlob blob;
    blob.nonce.assign(packed.begin(), packed.begin() + kGcmNonceBytes);
    blob.tag.assign(
        packed.begin() + kGcmNonceBytes,
        packed.begin() + kGcmNonceBytes + kGcmTagBytes);
    blob.ciphertext.assign(
        packed.begin() + kGcmNonceBytes + kGcmTagBytes,
        packed.end());
    return blob;
}

CredentialParts split_credential(std::string_view credential) {
    if (credential.size() != kCredentialLength) {
        throw std::invalid_argument("credential must be exactly 12 characters");
    }

    return CredentialParts{
        std::string(credential.substr(0, kSearchCodeLength)),
        std::string(credential.substr(kSearchCodeLength, kKeyCodeLength)),
    };
}

Bytes slow_kdf(std::string_view key_code, std::string_view salt) {
    Bytes output(kKeyBytes);
    ensure_openssl(
        PKCS5_PBKDF2_HMAC(
            key_code.data(),
            static_cast<int>(key_code.size()),
            reinterpret_cast<const unsigned char*>(salt.data()),
            static_cast<int>(salt.size()),
            kSlowKdfIterations,
            EVP_sha256(),
            static_cast<int>(output.size()),
            output.data()),
        "slow KDF failed");
    return output;
}

Bytes generate_fek() {
    return random_bytes(kKeyBytes);
}

Bytes random_bytes(std::size_t length) {
    Bytes output(length);
    ensure_openssl(
        RAND_bytes(output.data(), static_cast<int>(output.size())),
        "random bytes generation failed");
    return output;
}

Bytes sha256(const Bytes& data) {
    Bytes digest(kHashBytes);
    unsigned int digest_len = 0;
    ensure_openssl(
        EVP_Digest(
            data.data(),
            data.size(),
            digest.data(),
            &digest_len,
            EVP_sha256(),
            nullptr),
        "SHA-256 failed");
    digest.resize(digest_len);
    return digest;
}

Bytes encrypt(const Bytes& key, const Bytes& plaintext) {
    if (key.size() != kKeyBytes) {
        throw std::invalid_argument("encryption key must be 32 bytes");
    }

    EncryptedBlob blob;
    blob.nonce = random_bytes(kGcmNonceBytes);

    EVP_CIPHER_CTX* ctx = EVP_CIPHER_CTX_new();
    if (ctx == nullptr) {
        throw std::runtime_error("cipher context allocation failed");
    }

    blob.ciphertext.resize(plaintext.size());
    int out_len = 0;
    int total_len = 0;

    ensure_openssl(
        EVP_EncryptInit_ex(
            ctx,
            EVP_aes_256_gcm(),
            nullptr,
            nullptr,
            nullptr),
        "GCM encrypt init failed");
    ensure_openssl(
        EVP_CIPHER_CTX_ctrl(
            ctx,
            EVP_CTRL_GCM_SET_IVLEN,
            static_cast<int>(blob.nonce.size()),
            nullptr),
        "GCM set IV length failed");
    ensure_openssl(
        EVP_EncryptInit_ex(
            ctx,
            nullptr,
            nullptr,
            key.data(),
            blob.nonce.data()),
        "GCM encrypt set key failed");
    ensure_openssl(
        EVP_EncryptUpdate(
            ctx,
            blob.ciphertext.data(),
            &out_len,
            plaintext.data(),
            static_cast<int>(plaintext.size())),
        "GCM encrypt update failed");
    total_len = out_len;

    ensure_openssl(
        EVP_EncryptFinal_ex(ctx, blob.ciphertext.data() + total_len, &out_len),
        "GCM encrypt final failed");
    total_len += out_len;
    blob.ciphertext.resize(static_cast<std::size_t>(total_len));

    blob.tag.resize(kGcmTagBytes);
    ensure_openssl(
        EVP_CIPHER_CTX_ctrl(
            ctx,
            EVP_CTRL_GCM_GET_TAG,
            static_cast<int>(blob.tag.size()),
            blob.tag.data()),
        "GCM get tag failed");

    EVP_CIPHER_CTX_free(ctx);
    return blob.pack();
}

Bytes decrypt(const Bytes& key, const Bytes& packed_ciphertext) {
    if (key.size() != kKeyBytes) {
        throw std::invalid_argument("decryption key must be 32 bytes");
    }

    const EncryptedBlob blob = EncryptedBlob::unpack(packed_ciphertext);

    EVP_CIPHER_CTX* ctx = EVP_CIPHER_CTX_new();
    if (ctx == nullptr) {
        throw std::runtime_error("cipher context allocation failed");
    }

    Bytes plaintext(blob.ciphertext.size());
    int out_len = 0;
    int total_len = 0;

    ensure_openssl(
        EVP_DecryptInit_ex(
            ctx,
            EVP_aes_256_gcm(),
            nullptr,
            nullptr,
            nullptr),
        "GCM decrypt init failed");
    ensure_openssl(
        EVP_CIPHER_CTX_ctrl(
            ctx,
            EVP_CTRL_GCM_SET_IVLEN,
            static_cast<int>(blob.nonce.size()),
            nullptr),
        "GCM set IV length failed");
    ensure_openssl(
        EVP_DecryptInit_ex(
            ctx,
            nullptr,
            nullptr,
            key.data(),
            blob.nonce.data()),
        "GCM decrypt set key failed");
    ensure_openssl(
        EVP_DecryptUpdate(
            ctx,
            plaintext.data(),
            &out_len,
            blob.ciphertext.data(),
            static_cast<int>(blob.ciphertext.size())),
        "GCM decrypt update failed");
    total_len = out_len;

    ensure_openssl(
        EVP_CIPHER_CTX_ctrl(
            ctx,
            EVP_CTRL_GCM_SET_TAG,
            static_cast<int>(blob.tag.size()),
            const_cast<unsigned char*>(blob.tag.data())),
        "GCM set tag failed");

    const int final_result = EVP_DecryptFinal_ex(
        ctx,
        plaintext.data() + total_len,
        &out_len);
    EVP_CIPHER_CTX_free(ctx);

    if (final_result != 1) {
        throw std::runtime_error("GCM authentication failed");
    }

    total_len += out_len;
    plaintext.resize(static_cast<std::size_t>(total_len));
    return plaintext;
}

std::string derive_upload_token(
    std::string_view search_code,
    std::string_view salt_fix_search,
    std::uint32_t index) {
    const Bytes ikm(search_code.begin(), search_code.end());
    const std::string info = "Index-" + std::to_string(index) + "-12C";
    const Bytes token_bytes = derive_hkdf(
        ikm,
        std::string(salt_fix_search),
        info,
        kHashBytes);

    std::ostringstream stream;
    stream << std::hex << std::setfill('0');
    for (const auto byte : token_bytes) {
        stream << std::setw(2) << static_cast<int>(byte);
    }
    return stream.str();
}

}  // namespace twelve_c
