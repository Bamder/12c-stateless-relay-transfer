#include "twelve_c/merkle.hpp"

#include "twelve_c/crypto.hpp"

namespace twelve_c {

Bytes hash_block(const Bytes& block) {
    return sha256(block);
}

MerkleTree build_merkle_tree(const std::vector<Bytes>& blocks) {
    MerkleTree tree;
    if (blocks.empty()) {
        tree.root_hash = sha256({});
        tree.levels.push_back({tree.root_hash});
        return tree;
    }

    std::vector<Bytes> current_level;
    current_level.reserve(blocks.size());
    for (const auto& block : blocks) {
        current_level.push_back(hash_block(block));
    }
    tree.levels.push_back(current_level);

    while (current_level.size() > 1) {
        std::vector<Bytes> next_level;
        next_level.reserve((current_level.size() + 1) / 2);

        for (std::size_t index = 0; index < current_level.size(); index += 2) {
            Bytes combined;
            combined.insert(
                combined.end(),
                current_level[index].begin(),
                current_level[index].end());

            if (index + 1 < current_level.size()) {
                combined.insert(
                    combined.end(),
                    current_level[index + 1].begin(),
                    current_level[index + 1].end());
            } else {
                combined.insert(
                    combined.end(),
                    current_level[index].begin(),
                    current_level[index].end());
            }

            next_level.push_back(sha256(combined));
        }

        tree.levels.push_back(next_level);
        current_level = std::move(next_level);
    }

    tree.root_hash = current_level.front();
    return tree;
}

bool verify_merkle_path(
    const Bytes& block,
    const std::size_t leaf_index,
    const Bytes& root_hash,
    const MerkleTree& merkle_tree) {
    if (merkle_tree.root_hash != root_hash || merkle_tree.levels.empty()) {
        return false;
    }

    const auto& leaf_level = merkle_tree.levels.front();
    if (leaf_index >= leaf_level.size()) {
        return false;
    }

    return leaf_level[leaf_index] == hash_block(block);
}

bool verify_merkle_root(
    const std::vector<Bytes>& blocks,
    const Bytes& expected_root) {
    const MerkleTree tree = build_merkle_tree(blocks);
    return tree.root_hash == expected_root;
}

MerkleTree build_merkle_tree_from_leaf_hashes(
    const std::vector<Bytes>& leaf_hashes) {
    MerkleTree tree;
    if (leaf_hashes.empty()) {
        tree.root_hash = sha256({});
        tree.levels.push_back({tree.root_hash});
        return tree;
    }

    std::vector<Bytes> current_level = leaf_hashes;
    tree.levels.push_back(current_level);

    while (current_level.size() > 1) {
        std::vector<Bytes> next_level;
        next_level.reserve((current_level.size() + 1) / 2);

        for (std::size_t index = 0; index < current_level.size(); index += 2) {
            Bytes combined;
            combined.insert(
                combined.end(),
                current_level[index].begin(),
                current_level[index].end());

            if (index + 1 < current_level.size()) {
                combined.insert(
                    combined.end(),
                    current_level[index + 1].begin(),
                    current_level[index + 1].end());
            } else {
                combined.insert(
                    combined.end(),
                    current_level[index].begin(),
                    current_level[index].end());
            }

            next_level.push_back(sha256(combined));
        }

        tree.levels.push_back(next_level);
        current_level = std::move(next_level);
    }

    tree.root_hash = current_level.front();
    return tree;
}

bool verify_merkle_root_from_leaf_hashes(
    const std::vector<Bytes>& leaf_hashes,
    const Bytes& expected_root) {
    const MerkleTree tree = build_merkle_tree_from_leaf_hashes(leaf_hashes);
    return tree.root_hash == expected_root;
}

}  // namespace twelve_c
