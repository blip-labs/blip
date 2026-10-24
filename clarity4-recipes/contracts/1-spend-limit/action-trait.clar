;; Any app that wants to be called "with a spending limit" uses this shape.
(define-trait action
  ((run () (response bool uint))))
