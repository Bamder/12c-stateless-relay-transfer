#include "twelve_c/segment.hpp"

#include "twelve_c/constants.hpp"
#include "twelve_c/crypto.hpp"

#include <stdexcept>

namespace twelve_c {
namespace {

std::size_t ceil_div(const std::size_t numerator, const std::size_t denominator) {
    if (denominator == 0) {
        throw std::logic_error("ceil_div denominator must be greater than zero");
    }
    return (numerator + denominator - 1) / denominator;
}

}  // namespace

bool is_v2_whole_file_mode(const std::uint16_t segment_code) {
    return segment_code == kV2SegmentCodeWholeFile;
}

bool is_v21_segmented_mode(const std::uint16_t segment_code) {
    return segment_code >= kV21SegmentCodeMin && segment_code <= kV21SegmentCodeMax;
}

void validate_segment_code_v21(const std::uint16_t segment_code) {
    if (is_v2_whole_file_mode(segment_code)) {
        return;
    }
    if (!is_v21_segmented_mode(segment_code)) {
        throw std::runtime_error("unsupported segment_code");
    }
}

std::size_t decode_segment_plaintext_bytes_v21(const std::uint16_t segment_code) {
    validate_segment_code_v21(segment_code);
    if (is_v2_whole_file_mode(segment_code)) {
        throw std::logic_error("decode_segment_plaintext_bytes_v21 requires V2.1 code");
    }

    const std::uint32_t index = static_cast<std::uint32_t>(segment_code - 1);
    return static_cast<std::size_t>(1U << (index + 4)) * 1024 * 1024;
}

std::size_t segment_count_v21(
    const std::size_t padded_plaintext_length,
    const std::size_t segment_plaintext_bytes) {
    if (segment_plaintext_bytes == 0) {
        throw std::logic_error("segment_plaintext_bytes must be greater than zero");
    }
    return ceil_div(padded_plaintext_length, segment_plaintext_bytes);
}

std::size_t ciphertext_length_from_plaintext_v2(const std::size_t padded_plaintext_length) {
    return padded_plaintext_length + kGcmEnvelopeBytes;
}

std::size_t ciphertext_length_from_plaintext_v21(
    const std::size_t padded_plaintext_length,
    const std::uint16_t segment_code) {
    const std::size_t segment_plaintext_bytes =
        decode_segment_plaintext_bytes_v21(segment_code);
    const std::size_t count =
        segment_count_v21(padded_plaintext_length, segment_plaintext_bytes);
    return padded_plaintext_length + count * kGcmEnvelopeBytes;
}

std::size_t ciphertext_length_from_plaintext(
    const std::size_t padded_plaintext_length,
    const std::uint16_t segment_code) {
    if (is_v2_whole_file_mode(segment_code)) {
        return ciphertext_length_from_plaintext_v2(padded_plaintext_length);
    }
    return ciphertext_length_from_plaintext_v21(
        padded_plaintext_length,
        segment_code);
}

Bytes encrypt_payload_v2_whole_file(
    const Bytes& k_fek,
    const Bytes& plaintext_padded) {
    return encrypt(k_fek, plaintext_padded);
}

Bytes encrypt_payload_v21_segmented(
    const Bytes& k_fek,
    const Bytes& plaintext_padded,
    const std::uint16_t segment_code) {
    const std::size_t segment_plaintext_bytes =
        decode_segment_plaintext_bytes_v21(segment_code);

    Bytes ciphertext_stream;
    ciphertext_stream.reserve(
        ciphertext_length_from_plaintext_v21(plaintext_padded.size(), segment_code));

    for (std::size_t offset = 0; offset < plaintext_padded.size();) {
        const std::size_t chunk_length = std::min(
            segment_plaintext_bytes,
            plaintext_padded.size() - offset);
        const Bytes segment_plaintext(
            plaintext_padded.begin() + static_cast<std::ptrdiff_t>(offset),
            plaintext_padded.begin() +
                static_cast<std::ptrdiff_t>(offset + chunk_length));
        const Bytes segment_pack = encrypt(k_fek, segment_plaintext);
        ciphertext_stream.insert(
            ciphertext_stream.end(),
            segment_pack.begin(),
            segment_pack.end());
        offset += chunk_length;
    }

    if (ciphertext_stream.size() !=
        ciphertext_length_from_plaintext_v21(plaintext_padded.size(), segment_code)) {
        throw std::runtime_error("V2.1 segmented ciphertext length mismatch");
    }

    return ciphertext_stream;
}

Bytes decrypt_payload_v2_whole_file(
    const Bytes& k_fek,
    const Bytes& ciphertext_packed,
    const std::size_t padded_plaintext_length) {
    Bytes plaintext = decrypt(k_fek, ciphertext_packed);
    if (plaintext.size() != padded_plaintext_length) {
        throw std::runtime_error("V2 decrypted plaintext length mismatch");
    }
    return plaintext;
}

std::size_t padded_plaintext_length_from_ciphertext(
    const std::size_t ciphertext_length,
    const std::uint16_t segment_code) {
    if (is_v2_whole_file_mode(segment_code)) {
        if (ciphertext_length < kGcmEnvelopeBytes) {
            throw std::runtime_error("V2 ciphertext shorter than envelope");
        }
        return ciphertext_length - kGcmEnvelopeBytes;
    }

    const std::size_t segment_plaintext_bytes =
        decode_segment_plaintext_bytes_v21(segment_code);
    const std::size_t max_segments =
        segment_count_v21(ciphertext_length, 1);

    for (std::size_t segment_count = 1; segment_count <= max_segments; ++segment_count) {
        const std::size_t envelope_total = segment_count * kGcmEnvelopeBytes;
        if (ciphertext_length < envelope_total) {
            continue;
        }
        const std::size_t padded_plaintext_length =
            ciphertext_length - envelope_total;
        if (segment_count_v21(padded_plaintext_length, segment_plaintext_bytes) ==
            segment_count) {
            return padded_plaintext_length;
        }
    }

    throw std::runtime_error("V2.1 ciphertext length does not match segment_code");
}

Bytes decrypt_payload_v21_segmented(
    const Bytes& k_fek,
    const Bytes& ciphertext_stream,
    const std::uint16_t segment_code,
    const std::size_t padded_plaintext_length) {
    const std::size_t segment_plaintext_bytes =
        decode_segment_plaintext_bytes_v21(segment_code);

    Bytes plaintext_padded;
    plaintext_padded.reserve(padded_plaintext_length);

    std::size_t stream_offset = 0;
    std::size_t remaining_plaintext = padded_plaintext_length;

    while (remaining_plaintext > 0) {
        if (stream_offset >= ciphertext_stream.size()) {
            throw std::runtime_error("V2.1 ciphertext stream ended early");
        }

        const std::size_t segment_plain_length = std::min(
            segment_plaintext_bytes,
            remaining_plaintext);
        const std::size_t segment_pack_length =
            segment_plain_length + kGcmEnvelopeBytes;

        if (stream_offset + segment_pack_length > ciphertext_stream.size()) {
            throw std::runtime_error("V2.1 segment pack truncated");
        }

        const Bytes segment_pack(
            ciphertext_stream.begin() + static_cast<std::ptrdiff_t>(stream_offset),
            ciphertext_stream.begin() +
                static_cast<std::ptrdiff_t>(stream_offset + segment_pack_length));
        const Bytes segment_plain = decrypt(k_fek, segment_pack);
        if (segment_plain.size() != segment_plain_length) {
            throw std::runtime_error("V2.1 decrypted segment length mismatch");
        }

        plaintext_padded.insert(
            plaintext_padded.end(),
            segment_plain.begin(),
            segment_plain.end());
        stream_offset += segment_pack_length;
        remaining_plaintext -= segment_plain_length;
    }

    if (stream_offset != ciphertext_stream.size()) {
        throw std::runtime_error("V2.1 ciphertext stream has trailing bytes");
    }

    return plaintext_padded;
}

}  // namespace twelve_c
