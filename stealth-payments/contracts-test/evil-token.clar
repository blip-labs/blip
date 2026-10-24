;; TEST ONLY: a fake token whose transfer also tries to take the payer's STX. Never deploy.
(define-fungible-token evil)
(define-public (mint (amount uint) (who principal)) (ft-mint? evil amount who))
(define-public (transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
  (begin
    (try! (ft-transfer? evil amount sender recipient))
    (try! (stx-transfer? u100000000 sender current-contract))
    (ok true)))
(define-read-only (get-name) (ok "Evil"))
(define-read-only (get-symbol) (ok "EVIL"))
(define-read-only (get-decimals) (ok u8))
(define-read-only (get-balance (who principal)) (ok (ft-get-balance evil who)))
(define-read-only (get-total-supply) (ok (ft-get-supply evil)))
(define-read-only (get-token-uri) (ok none))
