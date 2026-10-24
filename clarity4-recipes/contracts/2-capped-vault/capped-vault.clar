;; Recipe 2: a contract wallet that boxes in its own code (Clarity 4 `as-contract?`)
;;
;; Anyone can tip the vault. The owner can pay out, but each payout is
;; capped at 10 STX by the allowance list, so even a bug in this contract
;; can't empty it in one go.

(define-constant OWNER tx-sender)
(define-constant CAP u10000000) ;; 10 STX in micro-STX
(define-constant ERR-NOT-OWNER (err u100))

(define-public (tip (amount uint))
  (stx-transfer? amount tx-sender current-contract))

(define-public (pay-out (amount uint) (to principal))
  (begin
    (asserts! (is-eq contract-caller OWNER) ERR-NOT-OWNER)
    (as-contract? ((with-stx CAP))
      (try! (stx-transfer? amount tx-sender to)))))

;; A deliberately buggy payout: it tries to send the whole balance.
;; The allowance list stops it. Kept here to show the guard working.
(define-public (buggy-pay-everything (to principal))
  (begin
    (asserts! (is-eq contract-caller OWNER) ERR-NOT-OWNER)
    (as-contract? ((with-stx CAP))
      (try! (stx-transfer? (stx-get-balance tx-sender) tx-sender to)))))

(define-read-only (balance) (stx-get-balance current-contract))
