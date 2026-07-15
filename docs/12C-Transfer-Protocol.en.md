```
Internet-Draft (Informational)
12C Stateless Relay Transfer Protocol
Cryptography and Wire Format Specification
Version 2
July 2026
```

# 12C Stateless Relay Transfer Protocol

## Cryptography and Wire Format Specification

|          |                                        |
| -------- | -------------------------------------- |
| Document | 12C-Transfer-Protocol                  |
| Version  | 2                                      |
| Date     | July 2026                              |
| Category | Informational                          |
| Scope    | On-wire cryptography and object layout |

---

## Abstract

This document defines the **12C Stateless Relay Transfer** object format: a fixed-layout metadata block (SMB), AES-256-GCM payload protection, Merkle integrity over wire blocks, and deterministic token identifiers for opaque blob storage.

Two payload encryption modes are defined, one per protocol edition:

- **V2** — one GCM operation over the full padded plaintext.
- **V2.1** — multiple independent GCM operations over plaintext segments; SMB wire size and `version` octet unchanged.

Transport, storage routing, and HTTP APIs are out of scope. Peers are assumed to exchange opaque octet blobs keyed by token identifiers.

---

## Status of This Memo

This document is an **Informational** specification of the 12C on-wire format. It is not an Internet Standards Track document.

Implementations claiming **V2** conformance MUST support `segment_code = 0`. Implementations claiming **V2.1** conformance MUST additionally support `segment_code` values in [Section 6.4](#64-file-name-slot-and-segment_code).

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Terminology](#2-terminology)
3. [Protocol Model](#3-protocol-model)
4. [Credential](#4-credential)
5. [Cryptographic Algorithms](#5-cryptographic-algorithms)
6. [SMB — Super Metadata Block](#6-smb--super-metadata-block)
7. [Payload Encryption](#7-payload-encryption)
8. [Wire Encoding](#8-wire-encoding)
9. [Merkle Integrity Tree](#9-merkle-integrity-tree)
10. [Sender Behavior](#10-sender-behavior)
11. [Receiver Behavior](#11-receiver-behavior)
12. [Protocol Editions](#12-protocol-editions)
13. [Security Considerations](#13-security-considerations)
14. [IANA Considerations](#14-iana-considerations)
15. [Normative References](#15-normative-references)

- [Appendix A. Protocol Constants](#appendix-a-protocol-constants)
- [Appendix B. Wire Layout Algorithm](#appendix-b-wire-layout-algorithm)
- [Appendix C. Informative Guidance](#appendix-c-informative-guidance)

---

## 1. Introduction

### 1.1. Purpose

12C encodes a file as a set of named byte blobs (tokens) plus a 12-character credential. A peer holding the credential and all tokens can verify integrity and recover the original file. No per-object server session state is required by this format.

### 1.2. Requirements Language

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are to be interpreted as described in [RFC2119].

### 1.3. Conventions

- **Octet:** 8-bit byte.
- **Octet string:** ordered sequence of octets.
- Multi-byte integers are **unsigned** unless stated otherwise.
- Ranges use half-open notation `[start, end)`.
- `||` denotes octet-string concatenation.
- `ceil(x)` is the smallest integer ≥ x.

### 1.4. Scope and Non-Goals

In scope: credential layout, SMB, payload encryption (V2/V2.1), wire block partitioning, Merkle root, token derivation.

Out of scope: blob upload/download protocols, replication, TTL policy, TLS usage, credential generation entropy requirements beyond [Section 13](#13-security-considerations).

---

## 2. Terminology

| Term          | Definition                                                        |
| ------------- | ----------------------------------------------------------------- |
| Credential    | 12-character code: 6-character search code + 6-character key code |
| SMB           | Super Metadata Block; 345-octet fixed metadata                    |
| S_enc         | SMB plaintext encrypted with K_smb; 373 octets                    |
| Token         | 64-character lowercase hex identifier labeling one wire blob      |
| Wire blob     | Octet string stored under one token                               |
| Segment       | (V2.1) Plaintext range encrypted by one GCM invocation            |
| FEK           | 32-octet random file encryption key                               |
| KEK           | 32-octet key derived from key code and salt_rand; encrypts FEK    |
| Logical block | One fragment B_i of payload ciphertext before wire packing        |
| segment_code  | 16-bit field selecting V2 vs V2.1 segment size                    |

---

## 3. Protocol Model

### 3.1. Object Layout

```text
Credential (12 chars, out of band)
        +
Token[0] || Token[1] || ... || Token[m-1]
        |
        v
   Recover file bytes
```

### 3.2. Data Flow

```text
File plaintext
    --> (optional prefix padding)
    --> Payload encryption (V2 or V2.1) --> C
    --> Wire split --> B_1 .. B_m
    --> Merkle root --> SMB body
    --> SMB serialize (345) --> encrypt --> S_enc (373)
    --> Token[0] = S_enc || B_m; Token[i] = B_i (i >= 1)
```

### 3.3. Invariants

1. SMB plaintext size MUST be 345 octets.
2. S_enc size MUST be 373 octets.
3. SMB `version` MUST be 2 for all editions in this document.
4. Segment boundaries (V2.1) and wire token boundaries are independent.

---

## 4. Credential

### 4.1. Syntax

```abnf
credential     = search-code key-code
search-code    = 6OCTET
key-code       = 6OCTET
```

The 12 characters are opaque to this specification. Parsing:

```text
search_code = credential[0:6]
key_code    = credential[6:12]
```

Receivers MUST reject credentials whose length is not exactly 12 characters.

---

## 5. Cryptographic Algorithms

### 5.1. Symmetric Encryption

| Parameter         | Value                                               |
| ----------------- | --------------------------------------------------- |
| Algorithm         | AES-256-GCM                                         |
| Key width         | 256 bits (32 octets)                                |
| Nonce width       | 96 bits (12 octets), fresh per encryption           |
| Tag width         | 128 bits (16 octets)                                |
| Envelope overhead | 28 octets (nonce and tag; excludes ciphertext body) |

### 5.2. GCM Record Format

One encryption output (a **GCM record**) MUST be encoded as:

```text
+--------+--------+-------------+
| nonce  | tag    | ciphertext  |
| 12     | 16     | N           |
+--------+--------+-------------+
```

Record length = N + 28. Decryption MUST verify the tag; failure MUST abort.

### 5.3. Key Hierarchy

**Slow KDF:**

```text
SlowKDF(password, salt, iter, len) = PBKDF2-HMAC-SHA256(
    password, salt, iter, len)
```

| Key   | Derivation                               |
| ----- | ---------------------------------------- |
| K_smb | SlowKDF(key_code, SALT_SMB, 100000, 32)  |
| K_kek | SlowKDF(key_code, salt_rand, 100000, 32) |
| K_fek | 32 octets uniformly random               |

Normative salt for K_smb:

```text
SALT_SMB = "12C-v2-KEY-SALT"  (ASCII, 14 octets)
```

`salt_rand` is 16 octets stored in SMB (see [Section 6.2](#62-body-fields)).

### 5.4. Token Identifier

```text
SALT_TOKEN = "12C-v2-SEARCH-SALT"  (ASCII, 19 octets)

token_digest = HKDF-SHA256(
    IKM  = octets(search_code),
    salt = SALT_TOKEN,
    info = "Index-" || decimal_string(index) || "-12C",
    L    = 32)

Token(index) = lowercase_hex(token_digest)   ; 64 hex characters
```

`index` is a zero-based unsigned integer.

### 5.5. Hash Function

SHA-256 is used for SMB digests and Merkle nodes.

---

## 6. SMB — Super Metadata Block

SMB is a **fixed sequential schema** (header-like layout), not a self-describing map. Fields are consumed in order; any trailing octets after the declared structure MUST cause rejection.

### 6.1. Plaintext SMB (345 octets)

```text
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                          magic (32 bits)                      |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|ver|                    body (272 octets)                      |
|   |                                                           |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                   body_hash (len + 32 octets)                   |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                   payload_hash (32 octets)                      |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

| Offset | Size | Field        | Semantics                         |
| ------ | ---- | ------------ | --------------------------------- |
| 0      | 4    | magic        | MUST be`0x31433232`             |
| 4      | 1    | version      | MUST be`2`                      |
| 5      | 272  | body         | [Section 6.2](#62-body-fields)     |
| 277    | 36   | body_hash    | `u32_be(32)` \|\| SHA-256(body) |
| 313    | 32   | payload_hash | SHA-256(octets[0:313])            |

**Validation:**

1. Recompute and match `payload_hash`.
2. Recompute and match `body_hash`.
3. Total size MUST be exactly 345 octets.

**Length-prefixed fields** in body use `u32_be(L)` followed by L octets.

### 6.2. Body Fields

| # | Field                | Encoding                                                     |
| - | -------------------- | ------------------------------------------------------------ |
| 1 | root_hash            | `u32_be(32)` \|\| 32 octets                                |
| 2 | encrypted_fek        | `u32_be(60)` \|\| GCM record encrypting FEK                |
| 3 | salt_rand            | `u32_be(16)` \|\| 16 octets                                |
| 4 | num_tokens           | u32_be                                                       |
| 5 | wire_block_size      | u32_be                                                       |
| 6 | ciphertext_length    | u64_be                                                       |
| 7 | original_file_length | u64_be                                                       |
| 8 | file_name_slot       | 128 octets;[Section 6.4](#64-file-name-slot-and-segment_code) |

### 6.3. Encrypted SMB Placement

```text
S_enc = GCM-Encrypt(K_smb, SMB_plaintext)
|S_enc| MUST equal 373
```

S_enc MUST occupy the first 373 octets of Token[0] with no length prefix.

### 6.4. File Name Slot and segment_code

The final body field is a fixed **128-octet** slot.

#### 6.4.1. Edition V2 (segment_code = 0)

- Octets `[0, 128)` carry the logical file name as UTF-8, zero-padded.
- Parsers MUST truncate at the first `0x00`, or strip trailing `0x00`.
- Writers MAY normalize path separators and UTF-8 boundaries; normalization is local policy.

When octets `[120, 128)` are all zero, `segment_code` is **0** (V2 whole-file mode).

#### 6.4.2. Edition V2.1 (segment_code >= 1)

```text
[0, 120)   file_name      UTF-8, zero-padded
[120, 122) segment_code   uint16_le
[122, 128) reserved       MUST be zero
```

**segment_code registry:**

| Code  | Edition | Segment plaintext size   |
| ----- | ------- | ------------------------ |
| 0     | V2      | (whole padded plaintext) |
| 1     | V2.1    | 2^4 MiB = 16 MiB         |
| 2     | V2.1    | 2^5 MiB = 32 MiB         |
| 3     | V2.1    | 2^6 MiB = 64 MiB         |
| 4     | V2.1    | 2^7 MiB = 128 MiB        |
| 5     | V2.1    | 2^8 MiB = 256 MiB        |
| other | —      | MUST be rejected         |

For code ≥ 1:

```text
i = code - 1
segment_plaintext_bytes = 2^(i + 4) * 2^20
```

Parsers MUST reject code > 0 if any reserved octet in `[122, 128)` is non-zero. Logical file names MUST NOT exceed 120 UTF-8 octets when code > 0.

---

## 7. Payload Encryption

### 7.1. Plaintext Padding

Senders MAY prepend `plaintext_padding` zero octets to the file plaintext to satisfy wire divisibility ([Appendix B](#appendix-b-wire-layout-algorithm)).

- `|plaintext_padded| = original_file_length + plaintext_padding`
- Padding MUST be a prefix.
- Receivers MUST strip the first `plaintext_padding` octets after decryption.

### 7.2. Edition V2 — Whole-File Mode

When `segment_code = 0`:

```text
C = GCM-Encrypt(K_fek, plaintext_padded)     ; single record

ciphertext_length MUST equal |plaintext_padded| + 28
```

### 7.3. Edition V2.1 — Segmented Mode

When `segment_code >= 1`:

1. Partition `plaintext_padded` into segments of at most `segment_plaintext_bytes`; the last segment MAY be shorter.
2. For each segment, form an independent GCM record under K_fek.
3. Concatenate records: `C = record_1 || record_2 || ... || record_n`.

```text
n = ceil(|plaintext_padded| / segment_plaintext_bytes)

ciphertext_length MUST equal |plaintext_padded| + n * 28
```

Each segment's nonce MUST be independent. Receivers MUST NOT infer segment boundaries from wire block boundaries.

### 7.4. FEK Wrapping

```text
encrypted_fek = GCM-Encrypt(K_kek, K_fek)
```

Stored in SMB field `encrypted_fek`.

---

## 8. Wire Encoding

Wire encoding applies identically once `ciphertext_length` is known.

### 8.1. Total Size

```text
SMB_ENC_SIZE = 373

total_wire = SMB_ENC_SIZE + ciphertext_length
```

### 8.2. Variables

| Symbol | SMB source      | Meaning                                  |
| ------ | --------------- | ---------------------------------------- |
| m      | num_tokens      | Token count                              |
| B      | wire_block_size | Size of Token[1..m-1]                    |
| B_m    | derived         | Length of final logical ciphertext block |

**Constraints:**

```text
m * B = total_wire
B_m + SMB_ENC_SIZE = B
ciphertext_length = (m - 1) * B + B_m
```

### 8.3. Logical Blocks

Split payload ciphertext C contiguously:

```text
|B_1| = ... = |B_{m-1}| = B
|B_m| = B_m
C = B_1 || B_2 || ... || B_m
```

### 8.4. Token Mapping

```text
wire(Token[0])  = S_enc || B_m
wire(Token[i])  = B_i          for i = 1 .. m-1

|wire(Token[i])| = B   for all i
```

Token names are derived per [Section 5.4](#54-token-identifier).

### 8.5. Segment vs Wire

`segment_code` MUST NOT influence m or B. Token layout depends only on `total_wire` and the algorithm in [Appendix B](#appendix-b-wire-layout-algorithm).

---

## 9. Merkle Integrity Tree

### 9.1. Leaves

`L_i = SHA-256(B_i)` for i = 1 .. m.

### 9.2. Construction

Pair child digests left-to-right, hash with SHA-256. If a level has odd cardinality, duplicate the last node before pairing.

### 9.3. Root

The root digest MUST equal SMB `root_hash`. Receivers MUST recompute from `{B_i}` and MUST reject on mismatch.

---

## 10. Sender Behavior

### 10.1. Inputs

A sender MUST obtain:

- `file_plaintext` and `original_file_length`
- `credential`
- `segment_code` (explicit; selection policy is local — see [Appendix C](#appendix-c-informative-guidance))
- Optional logical file name

### 10.2. Common Steps

1. Validate `segment_code`.
2. Compute wire layout from `original_file_length` and `segment_code` ([Appendix B](#appendix-b-wire-layout-algorithm)).
3. Form `plaintext_padded`.
4. Derive keys; generate FEK.
5. Produce C per [Section 7](#7-payload-encryption).
6. Split C into `{B_i}`; compute Merkle root.
7. Serialize SMB (345 octets) including metadata and `segment_code`.
8. Form S_enc; assemble Token[0] and Token[1..m-1].

### 10.3. Edition V2

Steps in [Section 10.2](#102-common-steps) with `segment_code = 0` and single GCM over full `plaintext_padded`.

### 10.4. Edition V2.1

As [Section 10.2](#102-common-steps), but step 5 uses segmented encryption ([Section 7.3](#73-edition-v21--segmented-mode)). Senders MAY process plaintext in segment-sized chunks; holding the entire file in memory is NOT required by this format.

---

## 11. Receiver Behavior

### 11.1. Common Steps

1. Obtain Token[0]; extract S_enc (first 373 octets).
2. Decrypt and parse SMB; read `segment_code`, m, B, `ciphertext_length`.
3. Obtain remaining tokens; reconstruct `{B_i}`.
4. Verify Merkle root.
5. Derive K_kek, decrypt FEK.

### 11.2. Edition V2

Concatenate logical blocks to C. Decrypt C as one GCM record. Strip prefix padding; output `original_file_length` octets.

### 11.3. Edition V2.1

Walk C sequentially. For each segment, read one GCM record whose plaintext length is determined by `segment_plaintext_bytes` and remaining output length. Decrypt; append. Strip prefix padding.

Receivers MUST use `segment_code` from SMB only. They MUST NOT infer mode from file size.

### 11.4. Failure Conditions

Receivers MUST fail if:

- `|C| ≠ ciphertext_length`
- Merkle verification fails
- Any GCM authentication fails
- `segment_code` is unrecognized
- Reserved file-name octets are non-zero when `segment_code > 0`
- Wire size constraints are violated

---

## 12. Protocol Editions

| Edition | segment_code | Payload encryption                            |
| ------- | ------------ | --------------------------------------------- |
| V2      | 0            | [Section 7.2](#72-edition-v2--whole-file-mode) |
| V2.1    | 1..5         | [Section 7.3](#73-edition-v21--segmented-mode) |

**Compatibility:**

| Scenario                  | Requirement                  |
| ------------------------- | ---------------------------- |
| V2.1 peer reads V2 object | MUST succeed                 |
| V2 peer reads V2.1 object | MUST fail (upgrade required) |
| V2.1 SMB`version`       | MUST remain 2                |
| SMB / S_enc sizes         | MUST remain 345 / 373        |

---

## 13. Security Considerations

**Credential secrecy.** Compromise of `key_code` reveals content. Compromise of `search_code` aids token enumeration. Credential generation is out of scope but MUST use adequate entropy in production systems.

**GCM nonce reuse.** Reusing a nonce under the same key with GCM is catastrophic. Each encryption operation MUST use a fresh nonce.

**Integrity.** Merkle root verification MUST precede payload decryption.

**Memory.** Edition V2 loads entire plaintext into one GCM operation at send and receive time; large objects may be impractical in constrained environments. Edition V2.1 permits segment-sized buffering.

**Transport.** This document does not specify TLS. Operators SHOULD protect credentials and blobs in transit.

**Token count.** Large objects yield many tokens when wire block size is small, increasing round trips. That is an operational trade-off, not a cryptographic weakness.

---

## 14. IANA Considerations

This document has no IANA actions.

The `segment_code` values 0..5 are defined in [Section 6.4.2](#642-edition-v21-segment_code--1). Extensions require a new protocol edition or an updated specification.

---

## 15. Normative References

**[RFC2119]** Bradner, S., "Key words for use in RFCs to Indicate Requirement Levels", BCP 14, RFC 2119, March 1997.

**[NIST-SP800-38D]** NIST, "Recommendation for Block Cipher Modes of Operation: Galois/Counter Mode (GCM) and GMAC", 2007.

**[RFC5869]** Krawczyk, H. and P. Eronen, "HMAC-based Extract-and-Expand Key Derivation Function (HKDF)", RFC 5869, May 2010.

**[RFC6234]** Eastlake 3rd, D. and T. Hansen, "US Secure Hash Algorithms", RFC 6234, May 2011.

**[RFC8018]** Moriarty, K. et al., "PKCS #5: Password-Based Cryptography Specification Version 2.1", RFC 8018, January 2017.

---

## Appendix A. Protocol Constants

| Name                    | Value                |
| ----------------------- | -------------------- |
| CREDENTIAL_LENGTH       | 12                   |
| SEARCH_CODE_LENGTH      | 6                    |
| KEY_CODE_LENGTH         | 6                    |
| SMB_MAGIC               | 0x31433232           |
| SMB_VERSION             | 2                    |
| SMB_PLAIN_SIZE          | 345                  |
| SMB_ENC_SIZE            | 373                  |
| FILE_NAME_SLOT_SIZE     | 128                  |
| FILE_NAME_PAYLOAD_V21   | 120                  |
| SEGMENT_CODE_OFFSET     | 120                  |
| GCM_NONCE_SIZE          | 12                   |
| GCM_TAG_SIZE            | 16                   |
| GCM_ENVELOPE_SIZE       | 28                   |
| HASH_SIZE               | 32                   |
| SALT_RAND_SIZE          | 16                   |
| KEY_SIZE                | 32                   |
| PBKDF2_ITERATIONS       | 100000               |
| MAX_WIRE_BLOCK_SIZE     | 16 777 216 (16 MiB)  |
| WIRE_BLOCK_REF_SIZE     | 4 194 304 (4 MiB)    |
| MIN_BLOCK_DIVISOR       | 8                    |
| MAX_TOKEN_SEARCH_WINDOW | 256                  |
| MAX_PLAINTEXT_PADDING   | 16 777 216 (16 MiB)  |
| TOKEN_HEX_LENGTH        | 64                   |
| SALT_SMB                | "12C-v2-KEY-SALT"    |
| SALT_TOKEN              | "12C-v2-SEARCH-SALT" |

---

## Appendix B. Wire Layout Algorithm

**Input:** `original_file_length`, `segment_code`
**Output:** `(m, B, B_m, plaintext_padding)`

### B.1. Ciphertext Length

Let P range from `original_file_length` upward by padding search.

```text
if segment_code = 0:
    ciphertext_length(P) = P + GCM_ENVELOPE_SIZE
else:
    n = ceil(P / segment_plaintext_bytes(segment_code))
    ciphertext_length(P) = P + n * GCM_ENVELOPE_SIZE

total_wire(P) = SMB_ENC_SIZE + ciphertext_length(P)
```

### B.2. Token Bounds

```text
B_min = min(MAX_WIRE_BLOCK_SIZE, total_wire / MIN_BLOCK_DIVISOR)

m_max = min(total_wire / B_min, total_wire / SMB_ENC_SIZE)
m_min = max(1,
            ceil(total_wire / MAX_WIRE_BLOCK_SIZE),
            ceil(ciphertext_length / WIRE_BLOCK_REF_SIZE))
            -- latter term only if feasible within m_max
```

If `m_min > m_max`, increase P and retry, up to `original_file_length + MAX_PLAINTEXT_PADDING`. Otherwise fail.

### B.3. Choosing m

Select the smallest valid m in `[m_min, min(m_min + MAX_TOKEN_SEARCH_WINDOW, m_max)]`, then up to `m_max`, such that:

- `total_wire % m = 0`
- `B = total_wire / m`
- `B_min ≤ B ≤ MAX_WIRE_BLOCK_SIZE`
- `B_m = ciphertext_length - (m-1)*B` and `B_m + SMB_ENC_SIZE = B`

Set `plaintext_padding = P - original_file_length`.

### B.4. Padding Placement

Encrypted padding octets MUST appear at the start of C and MUST map into Token[1..m-1], never into the B_m portion of Token[0].

---

## Appendix C. Informative Guidance

This appendix is non-normative.

**segment_code selection** is a local sender policy. This specification requires only that the chosen code be written into SMB and validated by peers. Example policy:

| File size | Suggested code       |
| --------- | -------------------- |
| ≤ 16 MiB | 0 (V2)               |
| > 16 MiB  | 4 (128 MiB segments) |

**Streaming.** Edition V2.1 is intended to allow segment-sized buffers; Edition V2 implies a single GCM over the full padded plaintext.

---

*End of document.*
