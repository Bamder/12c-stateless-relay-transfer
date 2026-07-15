#include "twelve_c/constants.hpp"
#include "twelve_c/receive_decrypt_session.hpp"
#include "twelve_c/receiver.hpp"
#include "twelve_c/upload_prepare_session.hpp"
#include "twelve_c/wire_layout.hpp"

#include <cstdint>
#include <iostream>
#include <stdexcept>
#include <string>

namespace {

constexpr std::size_t kFeedChunkBytes = 256 * 1024;
constexpr std::size_t kDrainChunkBytes = 4 * 1024 * 1024;
constexpr std::size_t kMaxWireBlockBytes = 32 * 1024 * 1024;

twelve_c::UploadMap prepare_upload_streaming(
    const twelve_c::Bytes& plaintext,
    const std::string& credential,
    const std::uint16_t segment_code) {
    twelve_c::UploadPrepareSession session(
        credential,
        "streaming-upload.bin",
        plaintext.size(),
        segment_code,
        kMaxWireBlockBytes);

    twelve_c::UploadMap uploads;
    for (std::size_t offset = 0; offset < plaintext.size();) {
        const std::size_t take = std::min(
            kFeedChunkBytes,
            plaintext.size() - offset);
        const twelve_c::Bytes chunk(
            plaintext.begin() + static_cast<std::ptrdiff_t>(offset),
            plaintext.begin() + static_cast<std::ptrdiff_t>(offset + take));
        session.feed(chunk);
        offset += take;

        for (const auto& block : session.take_ready_blocks()) {
            uploads[block.token] = block.data;
        }
    }

    const twelve_c::UploadWireBlock token0 = session.finalize();
    uploads[token0.token] = token0.data;
    return uploads;
}

twelve_c::Bytes drain_all_available(twelve_c::ReceiveDecryptSession& session) {
    twelve_c::Bytes drained;
    while (true) {
        twelve_c::Bytes chunk = session.take_plaintext_chunk(kDrainChunkBytes);
        if (chunk.empty()) {
            break;
        }
        drained.insert(drained.end(), chunk.begin(), chunk.end());
    }
    return drained;
}

void check_streaming_upload_roundtrip(
    const twelve_c::Bytes& plaintext,
    const std::uint16_t segment_code) {
    const std::string credential = "ABCDEF123456";
    const twelve_c::UploadMap uploads = prepare_upload_streaming(
        plaintext,
        credential,
        segment_code);

    const twelve_c::Bytes recovered =
        twelve_c::receive_from_upload_map(credential, uploads);
    if (recovered.size() != plaintext.size()) {
        throw std::runtime_error("receive length mismatch");
    }
    for (std::size_t index = 0; index < plaintext.size(); ++index) {
        if (recovered[index] != plaintext[index]) {
            throw std::runtime_error(
                "receive byte mismatch at offset " + std::to_string(index));
        }
    }

    const twelve_c::CredentialParts parts = twelve_c::split_credential(credential);
    const std::string token0_key = twelve_c::derive_upload_token(
        parts.search_code,
        twelve_c::kSaltFixSearch,
        0);
    const auto token0_iterator = uploads.find(token0_key);
    if (token0_iterator == uploads.end()) {
        throw std::runtime_error("token0 missing from upload map");
    }

    const auto metadata = twelve_c::parse_smb_encrypted(
        credential,
        token0_iterator->second);
    const std::uint32_t num_tokens = metadata.num_tokens;

    twelve_c::ReceiveDecryptSession session(credential, token0_iterator->second);
    twelve_c::Bytes streamed;
    for (std::uint32_t token_index = 1; token_index < num_tokens; ++token_index) {
        const std::string token_key = twelve_c::derive_upload_token(
            parts.search_code,
            twelve_c::kSaltFixSearch,
            token_index);
        const auto wire_iterator = uploads.find(token_key);
        if (wire_iterator == uploads.end()) {
            throw std::runtime_error("missing wire token in upload map");
        }
        session.add_wire_token(token_index, wire_iterator->second);
        const twelve_c::Bytes drained = drain_all_available(session);
        streamed.insert(streamed.end(), drained.begin(), drained.end());
    }

    session.complete_finalize();
    const twelve_c::Bytes tail = drain_all_available(session);
    streamed.insert(streamed.end(), tail.begin(), tail.end());

    if (streamed.size() != plaintext.size()) {
        throw std::runtime_error("streaming receive length mismatch");
    }
    for (std::size_t index = 0; index < plaintext.size(); ++index) {
        if (streamed[index] != plaintext[index]) {
            throw std::runtime_error(
                "streaming receive byte mismatch at offset " +
                std::to_string(index));
        }
    }

    const twelve_c::WireLayout layout = twelve_c::compute_wire_layout(
        plaintext.size(),
        segment_code,
        kMaxWireBlockBytes);
    std::cout << plaintext.size() << "B segment=" << segment_code
              << " padding=" << layout.plaintext_padding
              << " streaming upload OK\n";
}

}  // namespace

int main() {
    try {
        twelve_c::Bytes medium(17 * 1024 * 1024);
        for (std::size_t index = 0; index < medium.size(); ++index) {
            medium[index] = static_cast<std::uint8_t>((index * 23) & 0xFF);
        }
        check_streaming_upload_roundtrip(medium, 4);

        return 0;
    } catch (const std::exception& ex) {
        std::cerr << "FAIL: " << ex.what() << '\n';
        return 1;
    }
}
