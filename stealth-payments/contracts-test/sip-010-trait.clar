;; Standard SIP-010 fungible token trait (local copy, same as
;; mainnet SP3FBR2AGK5H9QBDH3EEN6DF8EC8JY7RX8QJ5SVTE.sip-010-trait-ft-standard).
(define-trait sip-010-trait
  (
    (transfer (uint principal principal (optional (buff 34))) (response bool uint))
    (get-name () (response (string-ascii 32) uint))
    (get-symbol () (response (string-ascii 32) uint))
    (get-decimals () (response uint uint))
    (get-balance (principal) (response uint uint))
    (get-total-supply () (response uint uint))
    (get-token-uri () (response (optional (string-utf8 256)) uint))
  )
)
