const debug = require('debug')('async-lambda-metrics')
const log = require('@dazn/lambda-powertools-logger')
const { extractLogEvents, processAll } = require('./lib')

const handler = async event => {
	try {
		debug('received invocation event', { event })

		const cwLogEvents = extractLogEvents(event)
  
		await processAll(cwLogEvents)
	} catch (error) {
		log.error('invocation failed...', { event }, error)
	}
}

exports.handler = handler
