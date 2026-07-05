#pragma once

#include "twelve_c/types.hpp"

#include <vector>

namespace twelve_c {

MerkleTree build_merkle_tree(const std::vector<Bytes>& blocks);

Bytes hash_block(const Bytes& block);

bool verify_merkle_path(
    const Bytes& block,
    std::size_t leaf_index,
    const Bytes& root_hash,
    const MerkleTree& merkle_tree);

bool verify_merkle_root(
    const std::vector<Bytes>& blocks,
    const Bytes& expected_root);

}  // namespace twelve_c
