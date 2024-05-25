const router = require('express').Router()
const { urlencoded } = require('body-parser')
const { commitmentsTable } = require('../utils/fadata-admin')
const { generateCsrfToken, validateCsrfToken } = require('../utils/csrf')
const { newEntityId } = require('../utils/identifier')
const { ago, formatted } = require('../utils/time')
const { BadRequestError } = require('../utils/error')
const { requiresAuth } = require('../utils/auth')

// endpoints

router.get('/commitments', requiresAuth(), async (req, res) => {
  const snapshot = await commitmentsTable
    .where('user_id', '==', req.user.id)
    .orderBy('started', 'asc')
    .get()

  if (snapshot.empty) {
    return res.render('commitments', {
      csrf_token: generateCsrfToken(req, res),
      commitments: []
    })
  }

  const commitments = snapshot.docs.map(doc => ({
    ...doc.data(),
    started: formatted(doc.data().started)
  }))

  const csrf_token = generateCsrfToken(req, res)
  res.render('commitments', { csrf_token, commitments })
})

router.post(
  '/commitments',
  requiresAuth(),
  urlencoded({ extended: false }),
  validateCsrfToken(),
  async (req, res) => {
    const { action } = req.body

    switch (action) {
      case 'add_commitment':
        const { description, started_ago } = req.body
        if (!description) {
          throw BadRequestError('Missing: description')
        }
        if (!started_ago) {
          throw BadRequestError('Missing: started_ago')
        }

        const newCommitment = {
          id: newEntityId(),
          description,
          started: ago(started_ago).toISO(),
          user_id: req.user.id
        }

        await commitmentsTable.add(newCommitment)
        break

      case 'delete_commitment':
        const { commitment_id } = req.body
        const deleteQuerySnapshot = await commitmentsTable
          .where('id', '==', commitment_id)
          .where('user_id', '==', req.user.id)
          .get()

        if (deleteQuerySnapshot.empty) {
          throw BadRequestError(
            'Commitment not found or not authorized to delete'
          )
        }

        await deleteQuerySnapshot.docs[0].ref.delete()
        break

      default:
        throw BadRequestError(`Unsupported action: ${action}`)
    }

    res.redirect('/commitments')
  }
)

module.exports = router
