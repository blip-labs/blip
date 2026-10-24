;; Recipe 3: "is this the audited code?" (Clarity 4 `contract-hash?`)
;;
;; The owner lists the fingerprints of code that passed a review.
;; Any contract whose code fingerprint is on the list counts as audited,
;; even a fresh copy deployed under another name.
;; Careful: the fingerprint covers the exact text, so changing even a
;; comment or a space makes it a different fingerprint.

(define-constant OWNER tx-sender)
(define-constant ERR-NOT-OWNER (err u100))
(define-map approved (buff 32) (string-ascii 64))

(define-public (approve-code-of (reviewed principal) (note (string-ascii 64)))
  (let ((h (try! (contract-hash? reviewed))))
    (asserts! (is-eq contract-caller OWNER) ERR-NOT-OWNER)
    (ok (map-set approved h note))))

(define-read-only (review-note (c principal))
  (match (contract-hash? c)
    h (map-get? approved h)
    e none))

(define-read-only (is-audited (c principal))
  (is-some (review-note c)))
