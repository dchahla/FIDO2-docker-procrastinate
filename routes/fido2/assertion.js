const router = require('express').Router()
const { json } = require('body-parser')
const {
  generateAuthenticationOptions,
  verifyAuthenticationResponse
} = require('@simplewebauthn/server')
const { isoBase64URL } = require('@simplewebauthn/server/helpers')

const { BadRequestError } = require('../../utils/error')
const { usersTable, credentialsTable } = require('../../utils/fadata-admin')
const {
  continueSignInWithPasskey,
  getAuthentication,
  completeSignIn
} = require('../../utils/auth')

const { RP_ID: rpID, BASE_URL: baseUrl } = process.env

// helpers

function FailedAuthenticationError () {
  return BadRequestError("We couldn't sign you in")
}

// endpoints

router.post('/options', json(), async (req, res) => {
  // validate request
  let { username, userVerification } = req.body
  username = username ? username.trim() : ''
  userVerification = userVerification || 'preferred'

  // fetch existing user and credentials
  let existingUser
  let existingCredentials = []
  if (username.length > 0) {
    const userSnapshot = await usersTable
      .where('username', '==', username)
      .get()
    if (!userSnapshot.empty) {
      existingUser = userSnapshot.docs[0].data()
    }

    if (!existingUser) {
      console.warn(`No such user with name '${username}'`)
      throw FailedAuthenticationError()
    }

    const credentialsSnapshot = await credentialsTable
      .where('user_id', '==', existingUser.id)
      .get()
    existingCredentials = credentialsSnapshot.docs.map(doc => doc.data())
  }

  // generate assertion options (challenge)
  const assertionOptions = await generateAuthenticationOptions({
    // require existing users to use a previously-registered authenticator
    allowCredentials: existingCredentials.map(c => ({
      id: isoBase64URL.toBuffer(c.id),
      type: 'public-key',
      transports: c.transports.split(',')
    })),
    userVerification
  })
  console.log(
    'DEBUG [/fido2/assertion/options] assertionOptions:',
    assertionOptions
  )

  // build response
  const challengeResponse = {
    status: 'ok',
    errorMessage: '',
    ...assertionOptions
  }
  console.log(
    'DEBUG [/fido2/assertion/options] Login challenge response:',
    challengeResponse
  )

  continueSignInWithPasskey(
    req,
    existingUser,
    challengeResponse.challenge,
    userVerification
  )

  res.json(challengeResponse)
})

router.post('/result', json(), async (req, res) => {
  // validate request
  const { body } = req
  const { id } = body
  if (!id) {
    throw BadRequestError('Missing: credential ID')
  }

  // retrieve authentication state from session
  const authentication = getAuthentication(req, false)
  console.log(
    'DEBUG [/fido2/assertion/result] Authentication state retrieved from session:',
    authentication
  )

  // find user credential
  const credentialSnapshot = await credentialsTable.where('id', '==', id).get()
  if (credentialSnapshot.empty) {
    console.log(
      `WARN [/fido2/assertion/result] No credential found with ID ${id}`
    )
    throw FailedAuthenticationError()
  }
  const activeCredential = credentialSnapshot.docs[0].data()
  if (
    authentication.userId &&
    activeCredential.user_id !== authentication.userId
  ) {
    console.log(
      `WARN [/fido2/assertion/result] Presented credential (id = ${activeCredential.id}) is not associated with specified user (id = ${authentication.userId})`
    )
    throw FailedAuthenticationError()
  }

  // fetch associated user
  const userSnapshot = await usersTable
    .where('id', '==', activeCredential.user_id)
    .get()
  if (userSnapshot.empty) {
    // NOTE: this shouldn't happen unless there's a data integrity issue
    throw new Error(
      `Cannot find user (id = ${activeCredential.user_id}) associated with active credential (id = ${activeCredential.id})`
    )
  }
  const existingUser = userSnapshot.docs[0].data()

  // verify assertion
  let verification
  try {
    verification = await verifyAuthenticationResponse({
      response: body,
      expectedChallenge: authentication.challenge,
      expectedOrigin: baseUrl,
      expectedRPID: rpID,
      authenticator: {
        ...activeCredential,
        credentialID: isoBase64URL.toBuffer(activeCredential.id),
        credentialPublicKey: isoBase64URL.toBuffer(activeCredential.public_key)
      }
    })
  } catch (err) {
    console.log(
      `WARN [/fido2/assertion/result] Authentication error with user (id = ${existingUser.id}) and credential (id = ${activeCredential.id}):`,
      err
    )
    throw FailedAuthenticationError()
  }
  console.log(`DEBUG [/fido2/assertion/result] verification:`, verification)

  // complete authentication
  const return_to = completeSignIn(req, existingUser, activeCredential.id)

  // build response
  const resultResponse = {
    status: 'ok',
    errorMessage: '',
    return_to
  }

  res.json(resultResponse)
})

module.exports = router
