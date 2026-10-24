;; stealth-announcer-v2: fresh-address (stealth) payments for Stacks. Clarity 4.
;; TESTNET ONLY until an outside review. Spec: SPEC.md.
;;
;; Money goes STRAIGHT from the payer to the one-time address `to`. This contract
;; never holds funds: no owner, no admin, no upgrade, no fees, no withdraw.
;; Its only state is a counter and the set of used one-time keys (eph).
;;
;; v2 changes:
;; - `to` must be a standard address on this network (is-standard).
;; - Each eph can be announced once, so a buggy payer can't reuse a fresh address.
;; - `stealth-pay-ft` runs the token inside `restrict-assets?`: the token contract
;;   may move at most `amount` of that token (and `gas` STX, below) out of the
;;   payer's wallet, and nothing else. A fake token can't take the payer's STX.
;; - `gas` (micro-STX, may be 0) goes to the same fresh address, so the receiver
;;   can later move the token without a sponsor. A sponsor's address is public on
;;   chain and would link every fresh address it pays for.

(use-trait sip-010-trait .sip-010-trait.sip-010-trait)

(define-constant ERR-AMOUNT (err u400))   ;; amount must be > 0
(define-constant ERR-EPH (err u401))      ;; eph must be a 33-byte compressed key (0x02/0x03 ...)
(define-constant ERR-TAG (err u402))      ;; tag must be exactly 1 byte
(define-constant ERR-TO (err u403))       ;; `to` must be a standard address on this network
(define-constant ERR-EPH-USED (err u404)) ;; this eph was already announced

(define-data-var announcements uint u0)
(define-map used-eph (buff 33) uint)

(define-read-only (get-count) (var-get announcements))
(define-read-only (eph-used (eph (buff 33))) (map-get? used-eph eph))

(define-read-only (valid-eph (eph (buff 33)))
  (and (is-eq (len eph) u33)
       (let ((p (default-to 0x00 (element-at? eph u0))))
         (or (is-eq p 0x02) (is-eq p 0x03)))))

(define-private (check (amount uint) (to principal) (eph (buff 33)) (tag (buff 1)))
  (begin
    (asserts! (> amount u0) ERR-AMOUNT)
    (asserts! (valid-eph eph) ERR-EPH)
    (asserts! (is-eq (len tag) u1) ERR-TAG)
    (asserts! (is-standard to) ERR-TO)
    (asserts! (is-none (get name (unwrap! (principal-destruct? to) ERR-TO))) ERR-TO)
    (asserts! (is-none (map-get? used-eph eph)) ERR-EPH-USED)
    (ok true)))

(define-private (announce (amount uint) (gas uint) (to principal) (eph (buff 33)) (tag (buff 1)) (token (optional principal)))
  (let ((id (+ (var-get announcements) u1)))
    (var-set announcements id)
    (map-set used-eph eph id)
    (print { event: "stealth", v: u2, to: to, amount: amount, gas: gas, eph: eph, tag: tag, sender: tx-sender, token: token, id: id })
    (ok id)))

;; Pay STX to a fresh address and announce it.
(define-public (stealth-pay (amount uint) (to principal) (eph (buff 33)) (tag (buff 1)))
  (begin
    (try! (check amount to eph tag))
    (try! (stx-transfer? amount tx-sender to))
    (announce amount u0 to eph tag none)))

;; Pay a SIP-010 token (e.g. sBTC) plus optional STX for future fees to a fresh address.
(define-public (stealth-pay-ft (token <sip-010-trait>) (amount uint) (gas uint) (to principal) (eph (buff 33)) (tag (buff 1)))
  (begin
    (try! (check amount to eph tag))
    (if (> gas u0) (try! (stx-transfer? gas tx-sender to)) true)
    (try! (restrict-assets? tx-sender ((with-ft (contract-of token) "*" amount))
      (try! (contract-call? token transfer amount tx-sender to none))))
    (announce amount gas to eph tag (some (contract-of token)))))
