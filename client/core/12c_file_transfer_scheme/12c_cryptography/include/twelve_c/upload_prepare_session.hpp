#pragma once

#include "twelve_c/constants.hpp"
#include "twelve_c/types.hpp"
#include "twelve_c/wire_layout.hpp"

#include <cstdint>
#include <string>
#include <vector>

namespace twelve_c {

struct UploadWireBlock {
    std::string token;
    Bytes data;
};

/**
 * Incremental upload preparation: feed plaintext chunks, take leading wire blocks,
 * then finalize token0. Peak memory is bounded by one GCM segment + one wire block.
 */
class UploadPrepareSession {
public:
    UploadPrepareSession(
        std::string credential,
        std::string original_file_name,
        std::size_t file_plaintext_size,
        std::uint16_t segment_code,
        std::size_t max_wire_block_bytes = kDefaultWireBlockBytesCap);

    void feed(const Bytes& chunk);
    std::vector<UploadWireBlock> take_ready_blocks();
    UploadWireBlock finalize();

    std::size_t file_bytes_fed() const { return file_bytes_fed_; }
    bool is_feed_complete() const { return file_bytes_fed_ >= original_file_size_; }

private:
    void append_plaintext_bytes(const std::uint8_t* data, std::size_t length);
    void append_padding_zeros(std::size_t count);
    void flush_segment_buffer_if_ready(bool force);
    void append_ciphertext_pack(const Bytes& pack);
    void try_emit_leading_blocks();

    CredentialParts credential_parts_;
    WireLayout layout_;
    std::uint16_t segment_code_ = 0;
    std::string original_file_name_;
    std::size_t original_file_size_ = 0;
    std::size_t file_bytes_fed_ = 0;
    std::size_t padding_remaining_ = 0;
    std::size_t segment_plaintext_bytes_ = 0;

    Bytes k_smb_;
    Bytes k_kek_;
    Bytes k_fek_;
    Bytes salt_rand_;

    Bytes segment_buffer_;
    Bytes wire_pending_;
    std::vector<Bytes> leaf_hashes_;
    std::vector<UploadWireBlock> ready_blocks_;
    std::size_t emitted_leading_count_ = 0;
    bool finalized_ = false;
};

}  // namespace twelve_c
