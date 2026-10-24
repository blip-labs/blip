;; Recipe 4: real-time deadlines (Clarity 4 `stacks-block-time`)
;;
;; Post a challenge score; a friend has 24 hours to answer it.
;; `stacks-block-time` is the current block's time in seconds (Unix time),
;; so deadlines can be in hours instead of guessing block counts.
;; It's set by the block producer, so treat it as accurate to a few minutes.

(define-constant DAY u86400)
(define-constant ERR-NO-CHALLENGE (err u100))
(define-constant ERR-TOO-LATE (err u101))
(define-constant ERR-ANSWERED (err u102))

(define-data-var last-id uint u0)
(define-map challenges uint
  { by: principal, score: uint, closes-at: uint, answer: (optional uint) })

(define-public (open-challenge (score uint))
  (let ((id (+ (var-get last-id) u1)))
    (var-set last-id id)
    (map-set challenges id
      { by: tx-sender, score: score, closes-at: (+ stacks-block-time DAY), answer: none })
    (ok id)))

(define-public (answer (id uint) (score uint))
  (let ((c (unwrap! (map-get? challenges id) ERR-NO-CHALLENGE)))
    (asserts! (< stacks-block-time (get closes-at c)) ERR-TOO-LATE)
    (asserts! (is-none (get answer c)) ERR-ANSWERED)
    (map-set challenges id (merge c { answer: (some score) }))
    (ok (> score (get score c)))))

(define-read-only (get-challenge (id uint)) (map-get? challenges id))
(define-read-only (seconds-left (id uint))
  (match (map-get? challenges id)
    c (if (< stacks-block-time (get closes-at c)) (- (get closes-at c) stacks-block-time) u0)
    u0))
