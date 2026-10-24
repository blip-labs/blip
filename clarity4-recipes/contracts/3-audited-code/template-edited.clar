;; A tiny counter, with one comment changed.
(define-data-var n uint u0)
(define-public (bump) (ok (var-set n (+ (var-get n) u1))))
(define-read-only (get-n) (var-get n))
