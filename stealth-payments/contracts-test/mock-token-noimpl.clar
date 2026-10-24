;; TEST ONLY mock token. Anyone can mint. Never deploy.
;; Deliberately has NO impl-trait line: shows trait args are checked by shape.
(define-fungible-token mock)
(define-public (mint (amount uint) (who principal)) (ft-mint? mock amount who))
(define-public (transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
  (begin
    (asserts! (or (is-eq tx-sender sender) (is-eq contract-caller sender)) (err u4))
    (try! (ft-transfer? mock amount sender recipient))
    (match memo m (print m) 0x)
    (ok true)))
(define-read-only (get-name) (ok "Mock"))
(define-read-only (get-symbol) (ok "MOCK"))
(define-read-only (get-decimals) (ok u8))
(define-read-only (get-balance (who principal)) (ok (ft-get-balance mock who)))
(define-read-only (get-total-supply) (ok (ft-get-supply mock)))
(define-read-only (get-token-uri) (ok none))
