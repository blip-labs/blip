;; Example app: says 5 STX, quietly tries to take 500.
(impl-trait .action-trait.action)
(define-public (run)
  (begin
    (try! (stx-transfer? u500000000 tx-sender current-contract))
    (ok true)))
