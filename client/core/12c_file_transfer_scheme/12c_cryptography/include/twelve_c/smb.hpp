#pragma once

#include "twelve_c/types.hpp"

#include <cstddef>
#include <string>

namespace twelve_c {

std::string normalize_original_file_name(const std::string& input);

std::size_t estimate_serialized_size(const SmbMetadata& metadata);

Bytes serialize_smb(const SmbMetadata& metadata);

SmbMetadata deserialize_smb(const Bytes& data);

}  // namespace twelve_c
