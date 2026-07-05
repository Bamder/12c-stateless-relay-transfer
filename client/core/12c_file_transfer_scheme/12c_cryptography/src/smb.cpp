#include "twelve_c/smb.hpp"

#include "twelve_c/constants.hpp"
#include "twelve_c/crypto.hpp"

#include <algorithm>
#include <cstring>
#include <stdexcept>

namespace twelve_c {

std::string normalize_original_file_name(const std::string& input) {
    if (input.empty()) {
        return {};
    }

    const std::size_t slash = input.find_last_of("/\\");
    std::string name = slash == std::string::npos ? input : input.substr(slash + 1);
    name.erase(std::remove(name.begin(), name.end(), '\0'), name.end());
    if (name.empty()) {
        return {};
    }

    if (name.size() > kMaxOriginalFileNameBytes) {
        name.resize(kMaxOriginalFileNameBytes);
        while (!name.empty() && (static_cast<unsigned char>(name.back()) & 0xC0) == 0x80) {
            name.pop_back();
        }
    }

    return name;
}

namespace {

void append_u32(Bytes& buffer, std::uint32_t value) {
    buffer.push_back(static_cast<std::uint8_t>((value >> 24) & 0xFF));
    buffer.push_back(static_cast<std::uint8_t>((value >> 16) & 0xFF));
    buffer.push_back(static_cast<std::uint8_t>((value >> 8) & 0xFF));
    buffer.push_back(static_cast<std::uint8_t>(value & 0xFF));
}

void append_bytes(Bytes& buffer, const Bytes& data) {
    append_u32(buffer, static_cast<std::uint32_t>(data.size()));
    buffer.insert(buffer.end(), data.begin(), data.end());
}

std::uint32_t read_u32(const Bytes& buffer, std::size_t& offset) {
    if (offset + 4 > buffer.size()) {
        throw std::runtime_error("SMB deserialize truncated u32");
    }

    const std::uint32_t value =
        (static_cast<std::uint32_t>(buffer[offset]) << 24) |
        (static_cast<std::uint32_t>(buffer[offset + 1]) << 16) |
        (static_cast<std::uint32_t>(buffer[offset + 2]) << 8) |
        static_cast<std::uint32_t>(buffer[offset + 3]);
    offset += 4;
    return value;
}

Bytes read_bytes(const Bytes& buffer, std::size_t& offset) {
    const std::uint32_t length = read_u32(buffer, offset);
    if (offset + length > buffer.size()) {
        throw std::runtime_error("SMB deserialize truncated bytes");
    }

    Bytes value(buffer.begin() + static_cast<std::ptrdiff_t>(offset),
                buffer.begin() + static_cast<std::ptrdiff_t>(offset + length));
    offset += length;
    return value;
}

void append_u64(Bytes& buffer, std::uint64_t value) {
    for (int shift = 56; shift >= 0; shift -= 8) {
        buffer.push_back(static_cast<std::uint8_t>((value >> shift) & 0xFF));
    }
}

std::uint64_t read_u64(const Bytes& buffer, std::size_t& offset) {
    if (offset + 8 > buffer.size()) {
        throw std::runtime_error("SMB deserialize truncated u64");
    }

    std::uint64_t value = 0;
    for (int shift = 56; shift >= 0; shift -= 8) {
        value |= static_cast<std::uint64_t>(buffer[offset++]) << shift;
    }
    return value;
}

void append_fixed_file_name(Bytes& buffer, const std::string& file_name) {
    Bytes field(kMaxOriginalFileNameBytes, 0);
    const std::size_t length = std::min(file_name.size(), kMaxOriginalFileNameBytes);
    if (length > 0) {
        std::memcpy(field.data(), file_name.data(), length);
    }
    buffer.insert(buffer.end(), field.begin(), field.end());
}

std::string read_fixed_file_name(const Bytes& buffer, std::size_t& offset) {
    if (offset + kMaxOriginalFileNameBytes > buffer.size()) {
        throw std::runtime_error("SMB deserialize truncated file name");
    }

    const char* begin = reinterpret_cast<const char*>(buffer.data() + offset);
    const char* end = begin + kMaxOriginalFileNameBytes;
    const char* terminator = static_cast<const char*>(std::memchr(begin, '\0', kMaxOriginalFileNameBytes));
    std::string value;
    if (terminator != nullptr) {
        value.assign(begin, terminator);
    } else {
        value.assign(begin, end);
        while (!value.empty() && value.back() == '\0') {
            value.pop_back();
        }
    }
    offset += kMaxOriginalFileNameBytes;
    return normalize_original_file_name(value);
}

Bytes build_body(const SmbMetadata& metadata) {
    Bytes body;
    append_bytes(body, metadata.root_hash);
    append_bytes(body, metadata.encrypted_fek.pack());
    append_bytes(body, metadata.salt_rand);
    append_u32(body, metadata.num_tokens);
    append_u32(body, metadata.wire_block_size);
    append_u64(body, metadata.ciphertext_length);
    append_u64(body, metadata.original_file_length);
    append_fixed_file_name(body, metadata.original_file_name);
    return body;
}

}  // namespace

std::size_t estimate_serialized_size(const SmbMetadata& metadata) {
    const Bytes body = build_body(metadata);
    return 4 + 1 + body.size() + 4 + kHashBytes + kHashBytes;
}

Bytes serialize_smb(const SmbMetadata& metadata) {
    const Bytes body = build_body(metadata);
    const Bytes body_hash = sha256(body);

    Bytes payload;
    append_u32(payload, kSmbMagic);
    payload.push_back(kSmbVersion);
    payload.insert(payload.end(), body.begin(), body.end());
    append_bytes(payload, body_hash);

    const Bytes payload_hash = sha256(payload);
    payload.insert(payload.end(), payload_hash.begin(), payload_hash.end());
    return payload;
}

SmbMetadata deserialize_smb(const Bytes& data) {
    if (data.size() < 4 + 1 + 4 + kHashBytes + kHashBytes) {
        throw std::runtime_error("SMB payload too short");
    }

    const Bytes expected_payload_hash(
        data.end() - static_cast<std::ptrdiff_t>(kHashBytes),
        data.end());
    const Bytes payload(
        data.begin(),
        data.end() - static_cast<std::ptrdiff_t>(kHashBytes));
    const Bytes actual_payload_hash = sha256(payload);
    if (actual_payload_hash != expected_payload_hash) {
        throw std::runtime_error("SMB payload hash mismatch");
    }

    std::size_t offset = 0;
    const std::uint32_t magic = read_u32(payload, offset);
    if (magic != kSmbMagic) {
        throw std::runtime_error("invalid SMB magic");
    }
    if (offset >= payload.size()) {
        throw std::runtime_error("SMB version missing");
    }

    const std::uint8_t version = payload[offset++];
    if (version != kSmbVersion) {
        throw std::runtime_error("unsupported SMB version");
    }

    const std::size_t body_start = offset;

    SmbMetadata metadata;
    metadata.root_hash = read_bytes(payload, offset);
    metadata.encrypted_fek = EncryptedBlob::unpack(read_bytes(payload, offset));
    metadata.salt_rand = read_bytes(payload, offset);
    metadata.merkle_tree.root_hash = metadata.root_hash;
    metadata.num_tokens = read_u32(payload, offset);
    metadata.wire_block_size = read_u32(payload, offset);
    metadata.ciphertext_length = read_u64(payload, offset);
    metadata.original_file_length = read_u64(payload, offset);
    metadata.original_file_name = read_fixed_file_name(payload, offset);

    const Bytes body(
        payload.begin() + static_cast<std::ptrdiff_t>(body_start),
        payload.begin() + static_cast<std::ptrdiff_t>(offset));
    const Bytes expected_body_hash = read_bytes(payload, offset);
    const Bytes actual_body_hash = sha256(body);
    if (actual_body_hash != expected_body_hash) {
        throw std::runtime_error("SMB body hash mismatch");
    }

    if (offset != payload.size()) {
        throw std::runtime_error("SMB trailing bytes detected");
    }

    return metadata;
}

}  // namespace twelve_c
