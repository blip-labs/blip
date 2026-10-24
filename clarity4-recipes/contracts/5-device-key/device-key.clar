;; Recipe 5: sign with a device key (Clarity 4 `secp256r1-verify`)
;;
;; secp256r1 (P-256) is the key type phones and browsers make with
;; WebCrypto. A player registers a device key once, then can sign a
;; 32-byte message (say, a score fingerprint) without a wallet popup.
;;
;; Heads-up, checked in tests: in Clarity 4 this function SHA-256 hashes
;; the 32 bytes you pass before checking. So pass the 32-byte message
;; itself and have the device sign it with ECDSA + SHA-256 (WebCrypto's
;; normal way). Passkey (WebAuthn) logins sign longer data, so they
;; don't check directly here.

(define-constant ERR-NO-KEY (err u100))
(define-constant ERR-BAD-SIG (err u101))
(define-constant ERR-USED (err u102))

(define-map device-keys principal (buff 33))
(define-map signed (buff 32) principal)

(define-public (register-key (pubkey (buff 33)))
  (ok (map-set device-keys tx-sender pubkey)))

(define-public (submit (player principal) (msg (buff 32)) (sig (buff 64)))
  (let ((key (unwrap! (map-get? device-keys player) ERR-NO-KEY)))
    (asserts! (secp256r1-verify msg sig key) ERR-BAD-SIG)
    (asserts! (map-insert signed msg player) ERR-USED)
    (ok true)))

(define-read-only (signer-of (msg (buff 32))) (map-get? signed msg))
