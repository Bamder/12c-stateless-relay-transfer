#pragma once

#include "twelve_c/types.hpp"

#include <cstddef>
#include <cstdint>

namespace twelve_c {

/** V2 whole-file mode: single GCM over entire padded plaintext. */
inline constexpr std::uint16_t kV2SegmentCodeWholeFile = 0;

/** V2.1 segmented mode: valid segment_code is [kV21SegmentCodeMin, kV21SegmentCodeMax]. */
inline constexpr std::uint16_t kV21SegmentCodeMin = 1;
inline constexpr std::uint16_t kV21SegmentCodeMax = 5;

inline constexpr std::size_t kV21FileNamePayloadBytes = 120;
inline constexpr std::size_t kV21SegmentCodeFieldOffset = 120;

bool is_v2_whole_file_mode(std::uint16_t segment_code);

bool is_v21_segmented_mode(std::uint16_t segment_code);

void validate_segment_code_v21(std::uint16_t segment_code);

std::size_t decode_segment_plaintext_bytes_v21(std::uint16_t segment_code);

std::size_t segment_count_v21(
    std::size_t padded_plaintext_length,
    std::size_t segment_plaintext_bytes);

std::size_t ciphertext_length_from_plaintext_v2(std::size_t padded_plaintext_length);

std::size_t ciphertext_length_from_plaintext_v21(
    std::size_t padded_plaintext_length,
    std::uint16_t segment_code);

std::size_t ciphertext_length_from_plaintext(
    std::size_t padded_plaintext_length,
    std::uint16_t segment_code);

Bytes encrypt_payload_v2_whole_file(const Bytes& k_fek, const Bytes& plaintext_padded);

Bytes encrypt_payload_v21_segmented(
    const Bytes& k_fek,
    const Bytes& plaintext_padded,
    std::uint16_t segment_code);

Bytes decrypt_payload_v2_whole_file(
    const Bytes& k_fek,
    const Bytes& ciphertext_packed,
    std::size_t padded_plaintext_length);

std::size_t padded_plaintext_length_from_ciphertext(
    std::size_t ciphertext_length,
    std::uint16_t segment_code);

Bytes decrypt_payload_v21_segmented(
    const Bytes& k_fek,
    const Bytes& ciphertext_stream,
    std::uint16_t segment_code,
    std::size_t padded_plaintext_length);

}  // namespace twelve_c
