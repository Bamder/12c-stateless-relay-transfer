#include "twelve_c/wire_layout.hpp"

#include "twelve_c/constants.hpp"
#include "twelve_c/smb.hpp"
#include "twelve_c/segment.hpp"
#include "twelve_c/types.hpp"

#include <algorithm>
#include <stdexcept>

namespace twelve_c {
namespace {

EncryptedBlob make_encrypted_fek_placeholder() {
    EncryptedBlob placeholder;
    placeholder.nonce.assign(kGcmNonceBytes, 0);
    placeholder.tag.assign(kGcmTagBytes, 0);
    placeholder.ciphertext.assign(kKeyBytes, 0);
    return placeholder;
}

SmbMetadata make_smb_size_skeleton() {
    SmbMetadata skeleton;
    skeleton.root_hash.assign(kHashBytes, 0);
    skeleton.encrypted_fek = make_encrypted_fek_placeholder();
    skeleton.salt_rand.assign(kSaltRandBytes, 0);
    return skeleton;
}

void verify_sm_schema_size() {
    const std::size_t estimated =
        estimate_serialized_size(make_smb_size_skeleton());
    if (estimated != kSmPlainBytes) {
        throw std::logic_error(
            "kSmPlainBytes out of sync with estimate_serialized_size");
    }
}

std::size_t ceil_div(const std::size_t numerator, const std::size_t denominator) {
    if (denominator == 0) {
        throw std::logic_error("ceil_div denominator must be greater than zero");
    }
    return (numerator + denominator - 1) / denominator;
}

std::size_t min_wire_block_size(
    const std::size_t total_wire,
    const std::size_t max_wire_block_bytes) {
    return std::min(
        max_wire_block_bytes,
        total_wire / kMinBlockSizeDivisor);
}

std::size_t max_token_count(
    const std::size_t total_wire,
    const std::size_t sm_enc_bytes,
    const std::size_t max_wire_block_bytes) {
    if (total_wire < sm_enc_bytes) {
        throw std::logic_error("total wire smaller than encrypted SMB");
    }

    const std::size_t min_block = min_wire_block_size(total_wire, max_wire_block_bytes);
    if (min_block == 0) {
        return 1;
    }

    const std::size_t by_min_block = total_wire / min_block;
    const std::size_t by_smb_floor = total_wire / sm_enc_bytes;
    return std::max<std::size_t>(1, std::min(by_min_block, by_smb_floor));
}

std::size_t min_token_count(
    const std::size_t total_wire,
    const std::size_t ciphertext_length,
    const std::size_t max_tokens,
    const std::size_t max_wire_block_bytes) {
    const std::size_t relay_min =
        ceil_div(total_wire, max_wire_block_bytes);
    const std::size_t ref_min =
        ceil_div(ciphertext_length, kWireBlockRef);

    std::size_t min_tokens = std::max<std::size_t>(1, relay_min);
    if (ref_min <= max_tokens) {
        min_tokens = std::max(min_tokens, ref_min);
    }
    if (min_tokens > max_tokens) {
        return min_tokens;
    }
    return min_tokens;
}

std::uint32_t choose_num_tokens(
    const std::size_t total_wire,
    const std::size_t ciphertext_length,
    const std::size_t sm_enc_bytes,
    const std::size_t max_wire_block_bytes) {
    const std::size_t max_m = max_token_count(
        total_wire,
        sm_enc_bytes,
        max_wire_block_bytes);
    const std::size_t min_m = min_token_count(
        total_wire,
        ciphertext_length,
        max_m,
        max_wire_block_bytes);

    if (max_m < min_m) {
        throw std::logic_error("wire layout: token range empty");
    }

    const std::size_t preferred_end =
        std::min(min_m + kMaxTokenAdjust, max_m);
    for (std::size_t candidate = min_m; candidate <= preferred_end; ++candidate) {
        if (total_wire % candidate != 0) {
            continue;
        }
        const std::size_t block_size = total_wire / candidate;
        if (block_size < min_wire_block_size(total_wire, max_wire_block_bytes)) {
            continue;
        }
        if (block_size > max_wire_block_bytes) {
            continue;
        }
        return static_cast<std::uint32_t>(candidate);
    }

    for (std::size_t candidate = preferred_end + 1; candidate <= max_m; ++candidate) {
        if (total_wire % candidate != 0) {
            continue;
        }
        const std::size_t block_size = total_wire / candidate;
        if (block_size < min_wire_block_size(total_wire, max_wire_block_bytes)) {
            continue;
        }
        if (block_size > max_wire_block_bytes) {
            continue;
        }
        return static_cast<std::uint32_t>(candidate);
    }

    throw std::logic_error("wire layout failed to choose num_tokens");
}

WireLayout compute_wire_layout_exact(
    const std::size_t plaintext_length,
    const std::uint16_t segment_code,
    const std::size_t max_wire_block_bytes) {
    WireLayout layout;
    layout.ciphertext_length =
        ciphertext_length_from_plaintext(plaintext_length, segment_code);

    const std::size_t sm_enc_bytes = sm_enc_size();
    layout.total_wire_bytes = sm_enc_bytes + layout.ciphertext_length;

    layout.num_tokens = choose_num_tokens(
        layout.total_wire_bytes,
        layout.ciphertext_length,
        sm_enc_bytes,
        max_wire_block_bytes);

    if (layout.total_wire_bytes % layout.num_tokens != 0) {
        throw std::logic_error("wire layout failed to partition total wire bytes");
    }

    layout.wire_block_size = static_cast<std::uint32_t>(
        layout.total_wire_bytes / layout.num_tokens);

    if (layout.wire_block_size < sm_enc_bytes) {
        throw std::logic_error("wire block smaller than encrypted SMB");
    }
    if (layout.wire_block_size > max_wire_block_bytes) {
        throw std::logic_error("wire block exceeds relay max body size");
    }
    if (layout.wire_block_size <
        min_wire_block_size(layout.total_wire_bytes, max_wire_block_bytes)) {
        throw std::logic_error("wire block smaller than minimum block size");
    }

    const std::size_t wire_block_size = layout.wire_block_size;
    layout.last_block_length =
        layout.ciphertext_length -
        static_cast<std::size_t>(layout.num_tokens - 1) * wire_block_size;

    if (sm_enc_bytes + layout.last_block_length != wire_block_size) {
        throw std::logic_error("token0 payload does not fill one wire block");
    }

    return layout;
}

std::size_t next_layout_padding(
    const std::size_t plaintext_length,
    const std::size_t sm_enc_bytes,
    const std::uint16_t segment_code,
    const std::size_t max_wire_block_bytes) {
    const std::size_t ciphertext_length =
        ciphertext_length_from_plaintext(plaintext_length, segment_code);
    const std::size_t total_wire = sm_enc_bytes + ciphertext_length;

    const std::size_t max_m = max_token_count(
        total_wire,
        sm_enc_bytes,
        max_wire_block_bytes);
    const std::size_t min_m = min_token_count(
        total_wire,
        ciphertext_length,
        max_m,
        max_wire_block_bytes);

    if (min_m > max_m) {
        const std::size_t target_m = min_m;
        const std::size_t aligned_total = target_m * max_wire_block_bytes;
        if (total_wire < aligned_total) {
            return aligned_total - total_wire;
        }
        const std::size_t remainder = total_wire % target_m;
        return remainder == 0 ? 1 : (target_m - remainder);
    }

    const std::size_t min_block = min_wire_block_size(total_wire, max_wire_block_bytes);
    for (std::size_t candidate = min_m; candidate <= max_m; ++candidate) {
        const std::size_t remainder = total_wire % candidate;
        if (remainder == 0) {
            const std::size_t block_size = total_wire / candidate;
            if (block_size >= min_block && block_size <= max_wire_block_bytes) {
                return 0;
            }
        }
        if (remainder != 0) {
            return candidate - remainder;
        }
    }

    return 1;
}

}  // namespace

std::size_t sm_enc_size() {
    static const bool verified = []() {
        verify_sm_schema_size();
        return true;
    }();
    (void)verified;
    return kSmEncBytes;
}

void validate_max_wire_block_bytes(const std::size_t max_wire_block_bytes) {
    if (max_wire_block_bytes < sm_enc_size()) {
        throw std::invalid_argument(
            "max_wire_block_bytes smaller than encrypted SMB size");
    }
    if (max_wire_block_bytes > kRelayMaxBodyBytesCap) {
        throw std::invalid_argument("max_wire_block_bytes exceeds implementation cap");
    }
}

std::size_t max_plaintext_padding_for_layout(
    const std::size_t max_wire_block_bytes) {
    // 规范默认 16 MiB；块上限更大时，单次对齐最坏约需一整块填充。
    return std::max(kMaxPlaintextPaddingForWireLayout, max_wire_block_bytes);
}

WireLayout compute_wire_layout(
    const std::size_t plaintext_length,
    const std::uint16_t segment_code,
    const std::size_t max_wire_block_bytes) {
    validate_segment_code_v21(segment_code);
    validate_max_wire_block_bytes(max_wire_block_bytes);

    const std::size_t padding_limit =
        max_plaintext_padding_for_layout(max_wire_block_bytes);
    std::size_t padding = 0;
    while (padding <= padding_limit) {
        try {
            WireLayout layout = compute_wire_layout_exact(
                plaintext_length + padding,
                segment_code,
                max_wire_block_bytes);
            layout.plaintext_padding = padding;
            return layout;
        } catch (const std::logic_error&) {
            const std::size_t step = next_layout_padding(
                plaintext_length + padding,
                sm_enc_size(),
                segment_code,
                max_wire_block_bytes);
            if (step == 0) {
                break;
            }
            padding += step;
        }
    }

    throw std::logic_error("wire layout failed after plaintext padding search");
}

}  // namespace twelve_c
