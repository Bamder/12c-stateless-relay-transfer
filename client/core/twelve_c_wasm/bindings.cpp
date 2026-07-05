#include <emscripten/bind.h>
#include <emscripten/val.h>

#include "twelve_c/constants.hpp"
#include "twelve_c/crypto.hpp"
#include "twelve_c/receiver.hpp"
#include "twelve_c/sender.hpp"
#include "twelve_c/smb_parser.hpp"

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

void ensure_crypto_ready() {
    static bool ready = false;
    if (ready) {
        return;
    }

    OPENSSL_init_crypto(OPENSSL_INIT_LOAD_CRYPTO_STRINGS, nullptr);

    const val crypto = val::global("crypto");
    if (!crypto.isUndefined() && !crypto["getRandomValues"].isUndefined()) {
        constexpr int kSeedBytes = 256;
        Bytes seed(kSeedBytes);
        val js_seed = val::global("Uint8Array").new_(kSeedBytes);
        crypto.call<void>("getRandomValues", js_seed);
        val(typed_memory_view(kSeedBytes, seed.data())).call<void>("set", js_seed);
        RAND_seed(seed.data(), kSeedBytes);
    }

    ready = true;
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
    for (std::size_t index = 0; index < data.size(); ++index) {
        js_array.set(static_cast<std::uint32_t>(index), data[index]);
    }
    return js_array;
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

val prepare_upload_js(
    const val& file_plaintext,
    const std::string& credential,
    const std::string& original_file_name) {
    ensure_crypto_ready();
    try {
        return upload_map_to_js(
            prepare_upload(
                val_to_bytes(file_plaintext),
                credential,
                original_file_name));
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
        return result;
    } catch (const std::exception& ex) {
        throw_js_error(std::string(ex.what()));
    } catch (...) {
        throw_js_error("parseSmbEncrypted failed");
    }
    return val::undefined();
}

}  // namespace

EMSCRIPTEN_BINDINGS(twelve_c_wasm) {
    function("prepareUpload", &prepare_upload_js);
    function("receiveFromUploadMap", &receive_from_upload_map_js);
    function("deriveUploadToken", &derive_upload_token_js);
    function("parseSmbEncrypted", &parse_smb_encrypted_js);
}
