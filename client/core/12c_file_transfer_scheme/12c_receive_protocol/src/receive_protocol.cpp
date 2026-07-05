#include "twelve_c/receive_protocol.hpp"

#include "twelve_c/constants.hpp"
#include "twelve_c/protocol_constants.hpp"
#include "twelve_c/crypto.hpp"
#include "twelve_c/receiver.hpp"
#include "twelve_c/smb_parser.hpp"

#include <stdexcept>

namespace twelve_c {

std::vector<std::string> derive_index_tokens(
    const std::string_view search_code,
    const std::uint32_t start_inclusive,
    const std::uint32_t end_exclusive) {
    if (end_exclusive < start_inclusive) {
        throw std::invalid_argument("invalid token index range");
    }

    std::vector<std::string> tokens;
    tokens.reserve(static_cast<std::size_t>(end_exclusive - start_inclusive));
    for (std::uint32_t index = start_inclusive; index < end_exclusive; ++index) {
        tokens.push_back(
            derive_upload_token(search_code, kSaltFixSearch, index));
    }
    return tokens;
}

ReceiveDownloadPlan compute_receive_download_plan(
    const std::string_view search_code,
    const std::uint32_t initial_tokens,
    const std::uint32_t num_tokens) {
    if (initial_tokens == 0) {
        throw std::invalid_argument("initial token count must be greater than zero");
    }

    ReceiveDownloadPlan plan;
    plan.num_tokens = num_tokens;

    plan.initial_prefetch =
        derive_index_tokens(search_code, 0, initial_tokens);

    if (plan.num_tokens > initial_tokens) {
        plan.fetch_after_smb =
            derive_index_tokens(search_code, initial_tokens, plan.num_tokens);
    } else if (initial_tokens > plan.num_tokens) {
        plan.cancel_after_smb =
            derive_index_tokens(search_code, plan.num_tokens, initial_tokens);
    }

    return plan;
}

Bytes receive_adaptive(
    const std::string& credential,
    ReceiveTransport& transport,
    const std::uint32_t initial_tokens) {
    if (initial_tokens == 0) {
        throw std::invalid_argument("initial token count must be greater than zero");
    }

    const CredentialParts parts = split_credential(credential);

    const std::vector<std::string> initial_prefetch =
        derive_index_tokens(parts.search_code, 0, initial_tokens);
    transport.start_concurrent_get(initial_prefetch);

    const std::string token0 =
        derive_upload_token(parts.search_code, kSaltFixSearch, 0);
    const Bytes token0_wire = transport.get(token0);
    const SmbMetadata metadata = parse_smb_encrypted(credential, token0_wire);

    const ReceiveDownloadPlan plan = compute_receive_download_plan(
        parts.search_code,
        initial_tokens,
        metadata.num_tokens);

    if (!plan.fetch_after_smb.empty()) {
        transport.start_concurrent_get(plan.fetch_after_smb);
    }
    if (!plan.cancel_after_smb.empty()) {
        transport.cancel_pending(plan.cancel_after_smb);
    }

    UploadMap uploads;
    uploads.emplace(token0, token0_wire);

    for (std::uint32_t token_index = 1; token_index < metadata.num_tokens; ++token_index) {
        const std::string token = derive_upload_token(
            parts.search_code,
            kSaltFixSearch,
            token_index);
        uploads.emplace(token, transport.get(token));
    }

    return receive_from_upload_map(credential, uploads);
}

}  // namespace twelve_c
