#pragma once

#include "twelve_c/types.hpp"

#include <cstddef>
#include <vector>

namespace twelve_c {

MerkleTree build_merkle_tree(const std::vector<Bytes>& blocks);

MerkleTree build_merkle_tree_from_leaf_hashes(const std::vector<Bytes>& leaf_hashes);

Bytes hash_block(const Bytes& block);

bool verify_merkle_path(
    const Bytes& block,
    std::size_t leaf_index,
    const Bytes& root_hash,
    const MerkleTree& merkle_tree);

bool verify_merkle_root(
    const std::vector<Bytes>& blocks,
    const Bytes& expected_root);

bool verify_merkle_root_from_leaf_hashes(
    const std::vector<Bytes>& leaf_hashes,
    const Bytes& expected_root);

}  // namespace twelve_c
