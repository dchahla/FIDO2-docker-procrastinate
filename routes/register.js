const router = require('express').Router()
const { urlencoded } = require('body-parser')

const { usersTable } = require('../utils/fadata-admin')
const { generateCsrfToken, validateCsrfToken } = require('../utils/csrf')
const { BadRequestError } = require('../utils/error')
const { capturePreAuthState, completeSignIn } = require('../utils/auth')
const { hash } = require('../utils/password')
const { createUser } = require('../utils/entity')

// endpoints

router.get('/register', async (req, res) => {
  capturePreAuthState(req)

  const csrf_token = generateCsrfToken(req, res)
  res.render('register', { csrf_token })
})

router.post(
  '/register',
  urlencoded({ extended: false }),
  validateCsrfToken(),
  async (req, res) => {
    const { username, password, display_name } = req.body
    if (!password) {
      throw BadRequestError('Missing: password')
    }

    const password_hash = await hash(password)
    const newUser = createUser(username, display_name, password_hash)

    try {
      const userQuerySnapshot = await usersTable
        .where('username', '==', username)
        .get()
      if (!userQuerySnapshot.empty) {
        const csrf_token = generateCsrfToken(req, res)
        return res.status(400).render('register', {
          csrf_token,
          username,
          display_name,
          error_message: 'User already exists'
        })
      }

      const userRef = await usersTable.add(newUser)
      const userDoc = await userRef.get()
      const user = userDoc.data()

      const returnTo = completeSignIn(req, user)
      res.redirect(returnTo)
    } catch (err) {
      throw err
    }
  }
)

module.exports = router
