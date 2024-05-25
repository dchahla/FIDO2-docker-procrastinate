const router = require('express').Router()
const { json } = require('body-parser')
const {
  generateRegistrationOptions,
  verifyRegistrationResponse
} = require('@simplewebauthn/server')
const { isoBase64URL } = require('@simplewebauthn/server/helpers')

const { BadRequestError } = require('../../utils/error')
const { usersTable, credentialsTable } = require('../../utils/fadata-admin')
const {
  beginSignup,
  getRegistration,
  completeSignIn
} = require('../../utils/auth')
const { now } = require('../../utils/time')
const { createUser } = require('../../utils/entity')

const { RP_ID: rpID, RP_NAME: rpName, BASE_URL: baseUrl } = process.env

// endpoints

router.post('/options', json(), async (req, res) => {
  const { username, displayName, attestation } = req.body

  let registeringUser
  let excludeCredentials

  if (req.user) {
    // registering user is an existing user
    const userSnapshot = await usersTable.doc(req.user.id).get()
    registeringUser = userSnapshot.data()
    if (!registeringUser) {
      throw BadRequestError(`User with ID ${req.user.id} no longer exists`)
    }

    // going to exclude existing credentials
    const credentialsSnapshot = await credentialsTable
      .where('user_id', '==', req.user.id)
      .get()
    excludeCredentials = credentialsSnapshot.docs.map(doc => doc.data())
  } else {
    // ensure new user is unique
    const userSnapshot = await usersTable
      .where('username', '==', username)
      .get()
    if (!userSnapshot.empty) {
      throw BadRequestError('User already exists')
    }

    // register user will be a new user
    registeringUser = createUser(username, displayName)

    // no existing credentials to exclude
    excludeCredentials = []
  }

  // generate options
  const attestationOptions = await generateRegistrationOptions({
    rpName,
    rpID,
    userID: registeringUser.id,
    userName: registeringUser.username,
    userDisplayName: registeringUser.display_name,
    attestationType: attestation,
    excludeCredentials: excludeCredentials.map(c => ({
      id: isoBase64URL.toBuffer(c.id),
      type: 'public-key',
      transports: c.transports.split(',')
    }))
  })

  // build response
  const optionsResponse = {
    ...attestationOptions,
    status: 'ok',
    errorMessage: ''
  }
  console.log(
    'DEBUG [/fido2/attestation/options] Registration challenge response:',
    optionsResponse
  )

  // store registration state in session
  beginSignup(req, registeringUser, optionsResponse.challenge)

  res.json(optionsResponse)
})

router.post('/result', json(), async (req, res) => {
  // validate request
  const { body } = req
  const { id, response } = body
  if (!id) {
    throw BadRequestError('Missing: credential ID')
  }
  if (!response) {
    throw BadRequestError('Missing: authentication response')
  }

  // retrieve registration state from session
  const registration = getRegistration(req)
  console.log(
    'DEBUG [/fido2/attestation/result] Registration state retrieved from session:',
    registration
  )

  // verify registration
  let verification
  try {
    verification = await verifyRegistrationResponse({
      response: body,
      expectedChallenge: registration.challenge,
      expectedOrigin: baseUrl,
      expectedRPID: rpID
    })
  } catch (err) {
    console.log(
      `WARN [/fido2/attestation/result] Registration error with username ${registration.username} and credential ${id}:`,
      err
    )

    throw BadRequestError(`Registration failed: ${err.message}`)
  }
  console.log('DEBUG [/fido2/attestation/result] verification:', verification)

  // build validated credential
  const {
    aaguid,
    credentialPublicKey,
    credentialID,
    counter,
    credentialDeviceType,
    credentialBackedUp
  } = verification.registrationInfo
  const validatedCredential = {
    id: isoBase64URL.fromBuffer(credentialID),
    created: now().toISO(),
    public_key: isoBase64URL.fromBuffer(credentialPublicKey),
    counter,
    aaguid,
    device_type: credentialDeviceType,
    is_backed_up: credentialBackedUp,
    transports: response.transports.join(',')
  }
  console.log(
    'DEBUG [/fido2/attestation/result] Validated credential:',
    validatedCredential
  )

  let { user } = req
  let return_to = '/'

  const insertCredential = async () => {
    validatedCredential.user_id = user.id
    await credentialsTable.add(validatedCredential)
  }

  if (user) {
    // create additional credential
    await insertCredential()
  } else {
    // create new user with initial credential
    const { registeringUser } = registration
    const userRef = await usersTable.add(registeringUser)
    const userDoc = await userRef.get()
    user = userDoc.data()

    // create first credential
    await insertCredential()

    // perform sign-in with newly registered user
    return_to = completeSignIn(req, user, validatedCredential.id)
  }

  // build response
  const resultResponse = {
    status: 'ok',
    errorMessage: '',
    return_to
  }

  res.json(resultResponse)
})

module.exports = router
