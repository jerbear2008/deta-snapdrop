import parser from 'ua-parser-js'
import { uniqueNamesGenerator, animals, colors } from 'unique-names-generator'
import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import { Base } from 'deta'
import { nanoid } from 'nanoid'

const expiration = {
  expireIn: 17,
}

function getName(request, id) {
  let ua = parser(request.headers['user-agent'])

  let deviceName = ''

  if (ua.os && ua.os.name) {
    deviceName = ua.os.name.replace('Mac OS', 'Mac') + ' '
  }

  if (ua.device.model) {
    deviceName += ua.device.model
  } else {
    deviceName += ua.browser.name
  }

  if (!deviceName) deviceName = 'Unknown Device'


  const idBuffer = Buffer.from(id, 'utf8')
  const idNumber = idBuffer.readUIntBE(0, 6)

  const displayName = uniqueNamesGenerator({
    length: 2,
    separator: ' ',
    dictionaries: [colors, animals],
    style: 'capital',
    seed: idNumber,
  })

  console.log('in gennames, made a name', displayName, {
    model: ua.device.model,
    os: ua.os.name,
    browser: ua.browser.name,
    type: ua.device.type,
    deviceName,
    displayName,
  })

  return {
    model: ua.device.model,
    os: ua.os.name,
    browser: ua.browser.name,
    type: ua.device.type,
    deviceName,
    displayName,
  }
}

async function getPeers() {
  const response = await users.fetch()
  if (response.last)
    Events.fire(
      'notify-user',
      'There are too many peers to fetch, showing 1MB of peers'
    )
  return response.items.map(({ key, name }) => {
    return { id: key, name }
  })
}

const users = Base('users')
const signals = Base('signals')
const fastify = Fastify({
  // logger: 'warn',
})
fastify.register(cookie)

async function updateUser(request, reply) {
  const id = request.cookies.peerid
  let peer = null
  try {
    if (id) peer = await users.get(id)
  } catch {}
  if (!(id && peer)) {
    const newId = id || nanoid()
    const name = getName(request, id)
    console.log('new name generated', name)
    await users.put({ name }, newId, expiration)
    reply.setCookie('peerid', newId)
    return { id: newId, name }
  }
  await users.update({}, id, expiration)
  return { id, name: peer.name }
}

fastify.delete('/update', async (request, reply) => {
  const id = request.cookies.peerid
  if (!id) return 'success (not found to delete)'
  await users.delete(id)
  return 'success'
})

fastify.get('/update', async (request, reply) => {
  const { id, name } = await updateUser(request, reply)
  const peersPromise = getOtherPeers(id)
  const signalsPromise = getSignals(id)
  console.log('these are not the errors you are looking for', {
    id,
    name,
    peers: await peersPromise,
    signals: await signalsPromise,
  })
  return {
    id,
    name,
    peers: await peersPromise,
    signals: await signalsPromise,
  }
})

async function getOtherPeers(id) {
  const peers = await getPeers()
  const otherPeers = id ? peers.filter((p) => p.id !== id) : peers
  return otherPeers
}
async function getSignals(id) {
  const { items: matchingSignals } = await signals.fetch({ to: id })
  for (const { key } of matchingSignals) {
    await signals.delete(key)
  }
  return matchingSignals.map((s) => ({ key: undefined, ...s }))
}

fastify.post('/signals', async (request, reply) => {
  const id = request.cookies.peerid
  if (!id) throw new Error('ID required in cookies for sending signals')
  const message = request.body
  if (
    !(
      message &&
      typeof message === 'object' &&
      'to' in message &&
      typeof message.to === 'string'
    )
  ) {
    console.error('bad message body', typeof message, message)
    throw new Error('Invalid message object')
  }
  await signals.put({ sender: id, ...message }, nanoid(), expiration)
  return 'success'
})

await fastify.listen({ port: process.env.PORT })
