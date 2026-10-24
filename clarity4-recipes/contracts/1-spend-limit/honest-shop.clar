;; Example app: charges 5 STX, as promised.
(impl-trait .action-trait.action)
(define-public (run)
  (begin
    (try! (stx-transfer? u5000000 tx-sender current-contract))
    (ok true)))
