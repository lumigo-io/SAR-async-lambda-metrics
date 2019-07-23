const _ = require('lodash')
const AWS = require('aws-sdk')
const zlib = require('zlib')
const debug = require('debug')('async-lambda-metrics')
const cloudWatch = new AWS.CloudWatch()

// node10.x messages are like this:
// INFO\tMONITORING|1|count|request_count|theburningmonk.com|service=content-item,region=eu-west-1\n
// while node8.10 messages are like this:
// MONITORING|1|count|request_count|theburningmonk.com|service=content-item,region=eu-west-1\n
const regex = new RegExp(/(INFO\s*)?MONITORING\|(\d*\.?\d*)\|(\S+)\|(\S+)\|(\S+)\|(\S*)/)

const tryParseEvent = event => {
	try {
		const match = regex.exec(event)
		if (!match) {
			return null
		}
    
		// eslint-disable-next-line no-unused-vars
		const [_matched, _info, value, unit, name, namespace, dimensionsCsv] = match
    
		// e.g. service=content-item,region=eu-west-1
		const dimensions = dimensionsCsv
			.split(',') // ['service=content-item', 'region=eu-west-1']
			.map(x => {
				const [ Name, Value ] = x.trim().split('=')
				return { Name, Value }
			})

		return {
			Value: parseFloat(value),
			Unit: unit,
			MetricName: name,
			Namespace: namespace,
			Dimensions: dimensions
		}
	} catch (e) {
		return null
	}
}

const parseLambdaLogData = event => {
	debug('Parsing lambda log event %o', event)

	const {
		event: rawEvent,
		timestamp: timestamp
	} = event.extractedFields

	const metric = tryParseEvent(rawEvent)

	if (!metric) {
		return null
	}
  
	return {
		Timestamp: timestamp,
		...metric
	}
}

const parseCWLogEvent = data => {
	const compressedPayload = Buffer.from(data, 'base64')
	const payload = zlib.gunzipSync(compressedPayload)
	const json = payload.toString('utf8')

	const cwLogEvent = JSON.parse(json)
	const { logGroup, logStream, logEvents } = cwLogEvent
	debug(`found [${logEvents.length}] logEvents from ${logGroup} - ${logStream}`)

	return cwLogEvent
}

const publish = async (namespace, metricDatum) => {
	const metricData = metricDatum.map(m => {
		return {
			MetricName : m.MetricName,
			Dimensions : m.Dimensions,
			Timestamp  : m.Timestamp,
			Unit       : m.Unit,
			Value      : m.Value
		}
	})

	// cloudwatch only allows 20 metrics per request
	const chunks = _.chunk(metricData, 20)

	for (const chunk of chunks) {
		const req = {
			MetricData: chunk,
			Namespace: namespace
		}
  
		await cloudWatch.putMetricData(req).promise()
  
		debug(`sent [${chunk.length}] metrics`)
	}  
}

const extractLogEvents = event => {
	// CloudWatch Logs
	if (event.awslogs) {
		return [parseCWLogEvent(event.awslogs.data)]
	}

	// Kinesis
	if (event.Records && event.Records[0].eventSource === 'aws:kinesis') {
		return event.Records.map(record => parseCWLogEvent(record.kinesis.data))
	}

	return []
}

const processAll = async (cwLogEvents) => {
	const metrics = _.flatMap(cwLogEvents, cwLogEvent => {
		// only Lambda logs are relevant
		if (!cwLogEvent.logGroup.startsWith('/aws/lambda')) {
			return []
		}

		return cwLogEvent.logEvents
			.map(parseLambdaLogData)
			.filter(x => x)
	})
  
	const groupedByNs = _.groupBy(metrics, 'Namespace')
	for (const namespace of Object.keys(groupedByNs)) {
		const metricDatum = groupedByNs[namespace]
		await publish(namespace, metricDatum)
	}
}

module.exports = {
	extractLogEvents,
	processAll
}
