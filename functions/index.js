const debug = require('debug')('async-lambda-metrics')
const { extractLogEvents, processAll } = require('./lib')

const handler = async event => {
	debug('received invocation event', { event })

	const cwLogEvents = extractLogEvents(event)

	await processAll(cwLogEvents)
}

exports.handler = handler
