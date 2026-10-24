;; stealth-registry: publish your pay-me keys on chain so wallets can look them up. Clarity 4.
;; TESTNET ONLY until an outside review. Spec: SPEC.md. Like ERC-6538 on Ethereum.
;;
;; Each address can set or clear only its own entry. No owner, no admin, no fees.
;; To pay `alice.btc` privately, a wallet finds the name's owner in BNS, then reads
;; that owner's entry here. Public keys only: nothing here can spend anything.

(define-constant ERR-KEY (err u410))      ;; keys must be 33-byte compressed (0x02/0x03 ...)
(define-constant ERR-VERSION (err u411))  ;; only scheme version 0 for now

(define-map codes principal { version: uint, scan: (buff 33), spend: (buff 33), set-at: uint })

(define-private (compressed? (k (buff 33)))
  (and (is-eq (len k) u33)
       (let ((p (default-to 0x00 (element-at? k u0))))
         (or (is-eq p 0x02) (is-eq p 0x03)))))

(define-public (set-code (version uint) (scan (buff 33)) (spend (buff 33)))
  (begin
    (asserts! (is-eq version u0) ERR-VERSION)
    (asserts! (and (compressed? scan) (compressed? spend)) ERR-KEY)
    (map-set codes tx-sender { version: version, scan: scan, spend: spend, set-at: stacks-block-time })
    (print { event: "stealth-code", who: tx-sender, version: version, scan: scan, spend: spend })
    (ok true)))

(define-public (clear-code)
  (begin
    (map-delete codes tx-sender)
    (print { event: "stealth-code-cleared", who: tx-sender })
    (ok true)))

(define-read-only (get-code (who principal)) (map-get? codes who))
