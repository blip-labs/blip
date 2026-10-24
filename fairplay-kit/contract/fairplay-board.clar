;; Fair Play Kit: scoreboard contract.
;; Stores one fingerprint (SHA-256 of the week's top scores) per week, written once and never changed.
;; Only the deployer can seal a week, and a sealed week can never be overwritten, not even by the deployer.
;; Anyone can read a week, check a fingerprint, or read the Bitcoin block hash a map was made from.

(define-constant OWNER tx-sender)
(define-constant ERR-NOT-OWNER (err u100))
(define-constant ERR-ALREADY-SEALED (err u101))
(define-constant ERR-EMPTY (err u102))

(define-map weeks
  uint
  { root: (buff 32), entries: uint, top-score: uint, sealed-at: uint })

;; Seal a week. contract-caller (not tx-sender) so another contract can't trick the owner into sealing.
(define-public (seal-week (week uint) (root (buff 32)) (entries uint) (top-score uint))
  (begin
    (asserts! (is-eq contract-caller OWNER) ERR-NOT-OWNER)
    (asserts! (> entries u0) ERR-EMPTY)
    (asserts! (map-insert weeks week { root: root, entries: entries, top-score: top-score, sealed-at: stacks-block-height })
              ERR-ALREADY-SEALED)
    (print { event: "seal-week", week: week, root: root, entries: entries, top-score: top-score })
    (ok true)))

(define-read-only (get-week (week uint))
  (map-get? weeks week))

;; true when `root` is exactly what was sealed for `week`
(define-read-only (check-week (week uint) (root (buff 32)))
  (match (map-get? weeks week) w (is-eq (get root w) root) false))

;; The Bitcoin block hash at a height, read by the chain itself: lets anyone check a map's seed on-chain.
(define-read-only (bitcoin-block-hash (height uint))
  (get-burn-block-info? header-hash height))
