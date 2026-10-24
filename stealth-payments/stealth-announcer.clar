;; stealth-announcer: fresh-address (stealth address) payment announcer for Stacks.
;; TESTNET ONLY until an outside review. Clarity 3, epoch 3.1.
;;
;; Money goes STRAIGHT from the payer (tx-sender) to the one-time address `to`.
;; This contract never holds funds: no owner, no admin, no withdraw, no as-contract
;; transfers. Its only state is a public counter of announcements.
;; The print event lets the receiver's scanner find payments meant for them.

;; Local copy of the standard SIP-010 trait (see contracts-test/sip-010-trait.clar).
;; Clarity 2+ checks trait arguments by shape, so any SIP-010 token (e.g. sBTC) can be passed.
(use-trait sip-010-trait .sip-010-trait.sip-010-trait)

(define-constant ERR-AMOUNT (err u400))   ;; amount must be > 0
(define-constant ERR-EPH (err u401))      ;; eph must be a 33-byte compressed key (0x02/0x03 ...)
(define-constant ERR-TAG (err u402))      ;; tag must be exactly 1 byte
(define-constant ERR-TO-SELF (err u403))  ;; never pay this contract itself

;; This contract's own principal, only used to refuse `to` = this contract.
(define-constant SELF (as-contract tx-sender))

(define-data-var announcements uint u0)

(define-read-only (get-count) (var-get announcements))

(define-read-only (valid-eph (eph (buff 33)))
  (and (is-eq (len eph) u33)
       (let ((p (default-to 0x00 (element-at? eph u0))))
         (or (is-eq p 0x02) (is-eq p 0x03)))))

(define-private (check (amount uint) (to principal) (eph (buff 33)) (tag (buff 1)))
  (begin
    (asserts! (> amount u0) ERR-AMOUNT)
    (asserts! (valid-eph eph) ERR-EPH)
    (asserts! (is-eq (len tag) u1) ERR-TAG)
    (asserts! (not (is-eq to SELF)) ERR-TO-SELF)
    (ok true)))

(define-private (announce (amount uint) (to principal) (eph (buff 33)) (tag (buff 1)) (token (optional principal)))
  (let ((id (+ (var-get announcements) u1)))
    (var-set announcements id)
    (print { event: "stealth", to: to, amount: amount, eph: eph, tag: tag, sender: tx-sender, token: token, id: id })
    (ok id)))

;; Pay STX to a fresh address and announce it.
(define-public (stealth-pay (amount uint) (to principal) (eph (buff 33)) (tag (buff 1)))
  (begin
    (try! (check amount to eph tag))
    (try! (stx-transfer? amount tx-sender to))
    (announce amount to eph tag none)))

;; Pay a SIP-010 token to a fresh address and announce it.
;; The token's own transfer runs with tx-sender = the payer (no as-contract here).
;; Payer wallets should use deny-mode post-conditions for the exact amount.
(define-public (stealth-pay-ft (token <sip-010-trait>) (amount uint) (to principal) (eph (buff 33)) (tag (buff 1)))
  (begin
    (try! (check amount to eph tag))
    (try! (contract-call? token transfer amount tx-sender to none))
    (announce amount to eph tag (some (contract-of token)))))
