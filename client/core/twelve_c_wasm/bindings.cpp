#include <emscripten/bind.h>
#include <emscripten/val.h>

#include "twelve_c/constants.hpp"
#include "twelve_c/crypto.hpp"
#include "twelve_c/receiver.hpp"
#include "twelve_c/receive_decrypt_session.hpp"
#include "twelve_c/sender.hpp"
#include "twelve_c/smb_parser.hpp"
#include "twelve_c/upload_prepare_session.hpp"

#include <openssl/crypto.h>
#include <openssl/rand.h>

#include <cstdint>
#include <exception>
#include <string>

using namespace emscripten;
using namespace twelve_c;

namespace {

void throw_js_error(const std::string& message) {
    val::global("Error").new_(message).throw_();
}

void ensure_openssl_initialized() {
    static bool initialized = false;
    if (initialized) {
        return;
    }

    OPENSSL_init_crypto(OPENSSL_INIT_LOAD_CRYPTO_STRINGS, nullptr);
    initialized = true;
}

void reseed_openssl_from_browser() {
    const val crypto = val::global("crypto");
    if (crypto.isUndefined() || crypto["getRandomValues"].isUndefined()) {
        throw_js_error(
            "crypto.getRandomValues is unavailable; use HTTPS or localhost");
    }

    constexpr int kSeedBytes = 256;
    Bytes seed(kSeedBytes);
    val js_seed = val::global("Uint8Array").new_(kSeedBytes);
    crypto.call<void>("getRandomValues", js_seed);
    val(typed_memory_view(kSeedBytes, seed.data())).call<void>("set", js_seed);
    RAND_seed(seed.data(), kSeedBytes);

    if (RAND_status() != 1) {
        throw_js_error("OpenSSL RNG failed to accept browser entropy");
    }
}

void ensure_crypto_ready() {
    ensure_openssl_initialized();
    reseed_openssl_from_browser();
}

Bytes val_to_bytes(const val& js_array) {
    if (js_array.instanceof(val::global("Uint8Array"))) {
        const std::size_t length = js_array["byteLength"].as<std::size_t>();
        Bytes output(length);
        if (length > 0) {
            val(typed_memory_view(length, output.data())).call<void>("set", js_array);
        }
        return output;
    }

    const auto length = js_array["length"].as<std::size_t>();
    Bytes output(length);
    for (std::size_t index = 0; index < length; ++index) {
        output[index] = js_array[static_cast<std::uint32_t>(index)].as<std::uint8_t>();
    }
    return output;
}

val bytes_to_val(const Bytes& data) {
    val js_array = val::global("Uint8Array").new_(data.size());
    if (!data.empty()) {
        js_array.call<void>("set", typed_memory_view(data.size(), data.data()));
    }
    return js_array;
}

val wire_blocks_to_js(const std::vector<UploadWireBlock>& blocks) {
    val entries = val::array();
    for (const auto& block : blocks) {
        val entry = val::object();
        entry.set("token", block.token);
        entry.set("data", bytes_to_val(block.data));
        entries.call<void>("push", entry);
    }
    return entries;
}

val wire_block_to_js(const UploadWireBlock& block) {
    val entry = val::object();
    entry.set("token", block.token);
    entry.set("data", bytes_to_val(block.data));
    return entry;
}

val upload_map_to_js(const UploadMap& uploads) {
    val entries = val::array();
    for (const auto& [token, blob] : uploads) {
        val entry = val::object();
        entry.set("token", token);
        entry.set("data", bytes_to_val(blob));
        entries.call<void>("push", entry);
    }
    return entries;
}

UploadMap js_to_upload_map(const val& entries) {
    UploadMap uploads;
    const auto length = entries["length"].as<unsigned>();
    for (unsigned index = 0; index < length; ++index) {
        const val entry = entries[index];
        uploads.emplace(
            entry["token"].as<std::string>(),
            val_to_bytes(entry["data"]));
    }
    return uploads;
}

void verify_upload_map_smb(
    const std::string& credential,
    const UploadMap& uploads) {
    const CredentialParts parts = split_credential(credential);
    const std::string token0_key = derive_upload_token(
        parts.search_code,
        kSaltFixSearch,
        0);
    const auto iterator = uploads.find(token0_key);
    if (iterator == uploads.end()) {
        throw std::runtime_error("internal verify: token0 missing from upload map");
    }
    parse_smb_encrypted(credential, iterator->second);
}

val prepare_upload_js(
    const val& file_plaintext,
    const std::string& credential,
    const std::string& original_file_name,
    const std::uint16_t segment_code,
    const std::size_t max_wire_block_bytes) {
    ensure_crypto_ready();
    try {
        const UploadMap uploads = prepare_upload(
            val_to_bytes(file_plaintext),
            credential,
            original_file_name,
            segment_code,
            max_wire_block_bytes);
        verify_upload_map_smb(credential, uploads);
        return upload_map_to_js(uploads);
    } catch (const std::exception& ex) {
        throw_js_error(std::string(ex.what()));
    } catch (...) {
        throw_js_error("prepareUpload failed");
    }
    return val::undefined();
}

val receive_from_upload_map_js(
    const std::string& credential,
    const val& entries) {
    ensure_crypto_ready();
    try {
        return bytes_to_val(receive_from_upload_map(credential, js_to_upload_map(entries)));
    } catch (const std::exception& ex) {
        throw_js_error(std::string(ex.what()));
    } catch (...) {
        throw_js_error("receiveFromUploadMap failed");
    }
    return val::undefined();
}

std::string derive_upload_token_js(
    const std::string& search_code,
    const std::uint32_t index) {
    ensure_crypto_ready();
    try {
        return derive_upload_token(search_code, kSaltFixSearch, index);
    } catch (const std::exception& ex) {
        throw_js_error(std::string(ex.what()));
    } catch (...) {
        throw_js_error("deriveUploadToken failed");
    }
    return {};
}

val parse_smb_encrypted_js(
    const std::string& credential,
    const val& smb_encrypted) {
    ensure_crypto_ready();
    try {
        const SmbMetadata metadata =
            parse_smb_encrypted(credential, val_to_bytes(smb_encrypted));

        val result = val::object();
        result.set("numTokens", metadata.num_tokens);
        result.set("wireBlockSize", metadata.wire_block_size);
        result.set("ciphertextLength", metadata.ciphertext_length);
        result.set("originalFileLength", metadata.original_file_length);
        result.set("originalFileName", metadata.original_file_name);
        result.set("segmentCode", metadata.segment_code);
        return result;
    } catch (const std::exception& ex) {
        throw_js_error(std::string(ex.what()));
    } catch (...) {
        throw_js_error("parseSmbEncrypted failed");
    }
    return val::undefined();
}

class UploadPrepareSessionBindings {
public:
    UploadPrepareSessionBindings(
        std::string credential,
        std::string original_file_name,
        const std::size_t file_plaintext_size,
        const std::uint16_t segment_code,
        const std::size_t max_wire_block_bytes)
        : session_(
              std::move(credential),
              std::move(original_file_name),
              file_plaintext_size,
              segment_code,
              max_wire_block_bytes) {}

    void feed(const val& chunk) {
        try {
            session_.feed(val_to_bytes(chunk));
        } catch (const std::exception& ex) {
            throw_js_error(std::string(ex.what()));
        } catch (...) {
            throw_js_error("upload prepare feed failed");
        }
    }

    val takeReadyBlocks() {
        try {
            return wire_blocks_to_js(session_.take_ready_blocks());
        } catch (const std::exception& ex) {
            throw_js_error(std::string(ex.what()));
        } catch (...) {
            throw_js_error("upload prepare takeReadyBlocks failed");
        }
        return val::array();
    }

    val finalize() {
        try {
            return wire_block_to_js(session_.finalize());
        } catch (const std::exception& ex) {
            throw_js_error(std::string(ex.what()));
        } catch (...) {
            throw_js_error("upload prepare finalize failed");
        }
        return val::undefined();
    }

private:
    UploadPrepareSession session_;
};

UploadPrepareSessionBindings* create_upload_prepare_session(
    std::string credential,
    std::string original_file_name,
    const std::size_t file_plaintext_size,
    const std::uint16_t segment_code,
    const std::size_t max_wire_block_bytes) {
    ensure_crypto_ready();
    try {
        return new UploadPrepareSessionBindings(
            std::move(credential),
            std::move(original_file_name),
            file_plaintext_size,
            segment_code,
            max_wire_block_bytes);
    } catch (const std::exception& ex) {
        throw_js_error(std::string(ex.what()));
    } catch (...) {
        throw_js_error("createUploadPrepareSession failed");
    }
    return nullptr;
}

class ReceiveDecryptSessionBindings {
public:
    ReceiveDecryptSessionBindings(
        std::string credential,
        const val& token0_wire)
        : session_(std::move(credential), val_to_bytes(token0_wire)) {}

    void addWireToken(const std::uint32_t token_index, const val& wire_data) {
        try {
            session_.add_wire_token(token_index, val_to_bytes(wire_data));
        } catch (const std::exception& ex) {
            throw_js_error(std::string(ex.what()));
        } catch (...) {
            throw_js_error("receive decrypt addWireToken failed");
        }
    }

    val finalize() {
        try {
            return bytes_to_val(session_.finalize());
        } catch (const std::exception& ex) {
            throw_js_error(std::string(ex.what()));
        } catch (...) {
            throw_js_error("receive decrypt finalize failed");
        }
        return val::undefined();
    }

    void completeFinalize() {
        try {
            session_.complete_finalize();
        } catch (const std::exception& ex) {
            throw_js_error(std::string(ex.what()));
        } catch (...) {
            throw_js_error("receive decrypt completeFinalize failed");
        }
    }

    std::size_t plaintextByteLength() const {
        try {
            return session_.plaintext_byte_length();
        } catch (const std::exception& ex) {
            throw_js_error(std::string(ex.what()));
        } catch (...) {
            throw_js_error("receive decrypt plaintextByteLength failed");
        }
        return 0;
    }

    std::size_t paddedPlaintextLength() const {
        return session_.padded_plaintext_length();
    }

    std::size_t originalFileLength() const {
        return session_.original_file_length();
    }

    val takePlaintextChunk(const std::size_t max_bytes) {
        try {
            return bytes_to_val(session_.take_plaintext_chunk(max_bytes));
        } catch (const std::exception& ex) {
            throw_js_error(std::string(ex.what()));
        } catch (...) {
            throw_js_error("receive decrypt takePlaintextChunk failed");
        }
        return val::undefined();
    }

private:
    ReceiveDecryptSession session_;
};

ReceiveDecryptSessionBindings* create_receive_decrypt_session(
    std::string credential,
    const val& token0_wire) {
    ensure_crypto_ready();
    try {
        return new ReceiveDecryptSessionBindings(
            std::move(credential),
            token0_wire);
    } catch (const std::exception& ex) {
        throw_js_error(std::string(ex.what()));
    } catch (...) {
        throw_js_error("createReceiveDecryptSession failed");
    }
    return nullptr;
}

val crypto_roundtrip_wasm_js(
    const val& file_plaintext,
    const std::string& credential,
    const std::uint16_t segment_code,
    const std::size_t max_wire_block_bytes) {
    ensure_crypto_ready();
    try {
        const UploadMap uploads = prepare_upload(
            val_to_bytes(file_plaintext),
            credential,
            "roundtrip.bin",
            segment_code,
            max_wire_block_bytes);
        return bytes_to_val(receive_from_upload_map(credential, uploads));
    } catch (const std::exception& ex) {
        throw_js_error(std::string(ex.what()));
    } catch (...) {
        throw_js_error("cryptoRoundtripWasm failed");
    }
    return val::undefined();
}

}  // namespace

EMSCRIPTEN_BINDINGS(twelve_c_wasm) {
    function("prepareUpload", &prepare_upload_js);
    function("receiveFromUploadMap", &receive_from_upload_map_js);
    function("deriveUploadToken", &derive_upload_token_js);
    function("parseSmbEncrypted", &parse_smb_encrypted_js);
    function("cryptoRoundtripWasm", &crypto_roundtrip_wasm_js);
    function(
        "createUploadPrepareSession",
        &create_upload_prepare_session,
        allow_raw_pointers());
    function(
        "createReceiveDecryptSession",
        &create_receive_decrypt_session,
        allow_raw_pointers());

    class_<UploadPrepareSessionBindings>("UploadPrepareSession")
        .function("feed", &UploadPrepareSessionBindings::feed)
        .function("takeReadyBlocks", &UploadPrepareSessionBindings::takeReadyBlocks)
        .function("finalize", &UploadPrepareSessionBindings::finalize);

    class_<ReceiveDecryptSessionBindings>("ReceiveDecryptSession")
        .function("addWireToken", &ReceiveDecryptSessionBindings::addWireToken)
        .function("finalize", &ReceiveDecryptSessionBindings::finalize)
        .function("completeFinalize", &ReceiveDecryptSessionBindings::completeFinalize)
        .function("plaintextByteLength", &ReceiveDecryptSessionBindings::plaintextByteLength)
        .function("paddedPlaintextLength", &ReceiveDecryptSessionBindings::paddedPlaintextLength)
        .function("originalFileLength", &ReceiveDecryptSessionBindings::originalFileLength)
        .function("takePlaintextChunk", &ReceiveDecryptSessionBindings::takePlaintextChunk);
}
