#pragma once

#include "twelve_c/types.hpp"

#include <cstdint>
#include <deque>
#include <string>
#include <vector>

namespace twelve_c {

/**
 * Incremental receive/decrypt: feed wire tokens 1..m-1 after token0, then finalize.
 * take_plaintext_chunk always returns original-file bytes (prefix padding stripped in
 * WASM via streaming skip). V2.1 segments are queued and drained incrementally so
 * WASM never assembles the full padded plaintext buffer.
 */
class ReceiveDecryptSession {
public:
    ReceiveDecryptSession(
        std::string credential,
        const Bytes& token0_wire);

    void add_wire_token(std::uint32_t token_index, const Bytes& wire_data);
    Bytes finalize();
    void complete_finalize();
    std::size_t plaintext_byte_length() const;
    std::size_t padded_plaintext_length() const;
    std::size_t original_file_length() const;
    Bytes take_plaintext_chunk(std::size_t max_bytes);

private:
    void feed_ciphertext(const std::uint8_t* data, std::size_t length);
    void feed_last_logical_block();
    void enqueue_plaintext(Bytes chunk);
    std::size_t ready_plaintext_available() const;
    std::size_t ready_file_bytes_available() const;
    void advance_ready_front(std::size_t byte_count);
    Bytes drain_ready_queue(std::size_t max_bytes);
    Bytes drain_plaintext_buffer(std::size_t max_bytes);

    CredentialParts credential_parts_;
    SmbMetadata metadata_;
    Bytes token0_wire_;
    std::size_t wire_block_size_ = 0;
    std::size_t last_block_length_ = 0;
    std::size_t padded_plaintext_length_ = 0;
    std::size_t original_file_length_ = 0;

    std::vector<Bytes> leaf_hashes_;
    std::uint32_t next_token_index_ = 1;

    Bytes k_fek_;
    bool k_fek_ready_ = false;

    Bytes ciphertext_pack_buffer_;
    std::size_t segment_plaintext_bytes_ = 0;
    std::size_t remaining_plaintext_ = 0;

    std::deque<Bytes> ready_plaintext_parts_;
    std::size_t ready_plaintext_offset_ = 0;
    std::size_t produced_plaintext_bytes_ = 0;
    std::size_t consumed_padded_bytes_ = 0;
    std::size_t exported_file_bytes_ = 0;
    std::size_t prefix_skip_remaining_ = 0;

    Bytes plaintext_padded_;

    bool finalized_ = false;
};

}  // namespace twelve_c
