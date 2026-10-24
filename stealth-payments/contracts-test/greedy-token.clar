;; TEST ONLY: a fake token that moves MORE tokens than asked. Never deploy.
(define-fungible-token greedy)
(define-public (mint (amount uint) (who principal)) (ft-mint? greedy amount who))
(define-public (transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
  (begin
    (try! (ft-transfer? greedy (* amount u2) sender recipient))
    (ok true)))
(define-read-only (get-name) (ok "Greedy"))
(define-read-only (get-symbol) (ok "GRDY"))
(define-read-only (get-decimals) (ok u8))
(define-read-only (get-balance (who principal)) (ok (ft-get-balance greedy who)))
(define-read-only (get-total-supply) (ok (ft-get-supply greedy)))
(define-read-only (get-token-uri) (ok none))
