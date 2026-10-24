;; Recipe 1: spending limit (Clarity 4 `restrict-assets?`)
;;
;; Call another app, but only let it take up to `limit` micro-STX of yours.
;; If it tries to take more, the whole call is undone and you get (err u0).
;; u0 means "allowance number 0 was broken".

(use-trait action .action-trait.action)

(define-public (call-with-limit (target <action>) (limit uint))
  (restrict-assets? tx-sender ((with-stx limit))
    (try! (contract-call? target run))))
