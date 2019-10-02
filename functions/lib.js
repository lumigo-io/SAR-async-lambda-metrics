const _ = require('lodash')
const AWS = require('aws-sdk')
const zlib = require('zlib')
const debug = require('debug')('async-lambda-metrics')
const log = require('@dazn/lambda-powertools-logger')
const retry = require('async-retry')
const cloudWatch = new AWS.CloudWatch()

// node10.x messages are like this:
// INFO\tMONITORING|1|count|request_count|theburningmonk.com|service=content-item,region=eu-west-1\n
// while node8.10 messages are like this:
// MONITORING|1|count|request_count|theburningmonk.com|service=content-item,region=eu-west-1\n
const regex = new RegExp(/(INFO\s*)?MONITORING\|(\d*\.?\d*)\|(\S+)\|(\S+)\|(\S+)\|(\S*)/)

function* tryParseCustomMetric(event, dimensions, timestamp) {
	try {
		const match = regex.exec(event)
		if (!match) {
			return
		}
    
		// eslint-disable-next-line no-unused-vars
		const [_matched, _info, value, unit, name, namespace, dimensionsCsv] = match
    
		// e.g. service=content-item,region=eu-west-1
		const userDimensions = dimensionsCsv
			.split(',') // ['service=content-item', 'region=eu-west-1']
			.map(x => {
				const [ Name, Value ] = x.trim().split('=')
				return { Name, Value }
			})
      
		dimensions.forEach(({ Name, Value }) => {
			if (!userDimensions.find(x => x.Name === Name)) {
				userDimensions.push({ Name, Value })
			}
		})

		yield makeMetric(parseFloat(value), unit, name, userDimensions, namespace, timestamp)
	} catch (e) {
		log.error('failed to parse custom metric, skipped...', { event, timestamp })
		return
	}
}

function* tryParseUsageMetrics(event, dimensions, timestamp) {
	try {
		if (event.startsWith('REPORT RequestId:')) {
			const billedDuration = parseFloatWith(/Billed Duration: (.*) ms/i, event)
			const memorySize = parseFloatWith(/Memory Size: (.*) MB/i, event)
			const memoryUsed = parseFloatWith(/Max Memory Used: (.*) MB/i, event)
      
			const namespace = 'AWS/Lambda'

			yield makeMetric(billedDuration, 'Milliseconds', 'BilledDuration', dimensions, namespace, timestamp)
			yield makeMetric(memorySize, 'Megabytes', 'MemorySize', dimensions, namespace, timestamp)
			yield makeMetric(memoryUsed, 'Megabytes', 'MemoryUsed', dimensions, namespace, timestamp)
		}
	} catch (e) {
		log.error('failed to parse Lambda usage metrics, skipped...', { event, timestamp })
		return
	}
}

function* tryParseCostMetric(event, dimensions, timestamp) {
	try {
		if (event.startsWith('REPORT RequestId:')) {
			const billedDuration = parseFloatWith(/Billed Duration: (.*) ms/i, event)
			const memorySize = parseFloatWith(/Memory Size: (.*) MB/i, event)
      
			const namespace = 'AWS/Lambda'
			const estimatedCost = (billedDuration / 100) * (memorySize / 128) * 0.000000208

			yield makeMetric(estimatedCost, 'None', 'EstimatedCost', dimensions, namespace, timestamp)
		}
	} catch (e) {
		log.error('failed to parse Lambda cost metric, skipped...', { event, timestamp })
		return
	}
}

function* tryParseColdStartMetric(event, dimensions, timestamp) {
	try {
		if (event.startsWith('REPORT RequestId:') && event.includes('Init Duration:')) {
			const initDuration = parseFloatWith(/Init Duration: (.*) ms/i, event)
      
			const namespace = 'AWS/Lambda'

			yield makeMetric(initDuration, 'Milliseconds', 'InitDuration', dimensions, namespace, timestamp)
		}
	} catch (e) {
		log.error('failed to parse Lambda cold start metric, skipped...', { event, timestamp })
		return
	}
}

function parseFloatWith(regex, input) {
	const res = regex.exec(input)
	return parseFloat(res[1])
}

function makeMetric(value, unit, name, dimensions, namespace, timestamp) {
	return {
		Value: value,
		Unit: unit,
		MetricName: name,
		Dimensions: dimensions,
		Namespace: namespace,
		Timestamp: timestamp
	}
}

function* parseRawLogData (dimensions, logEvent) {
	debug('Parsing raw log event %o', logEvent)
  
	const timestamp = new Date(logEvent.timestamp).toJSON()
  
	yield* tryParseCustomMetric(logEvent.event, dimensions, timestamp)
}

function* parseLambdaLogData (dimensions, event) {
	debug('Parsing lambda log event %o', event)  
  
	const rawEvent = _.get(event, 'extractedFields.event', event.message)
	const timestamp = _.get(
		event, 
		'extractedFields.timestamp', 
		new Date(event.timestamp).toJSON())

	yield* tryParseCustomMetric(rawEvent, dimensions, timestamp)	
  
	if (process.env.RECORD_LAMBDA_USAGE_METRICS === 'true') {
		yield* tryParseUsageMetrics(rawEvent, dimensions, timestamp)
	}
  
	if (process.env.RECORD_LAMBDA_COST_METRIC === 'true') {
		yield* tryParseCostMetric(rawEvent, dimensions, timestamp)
	}

	if (process.env.RECORD_LAMBDA_COLD_START_METRIC === 'true') {
		yield* tryParseColdStartMetric(rawEvent, dimensions, timestamp)
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

const parseKinesisEvent = kinesis => {
	const event = Buffer.from(kinesis.data, 'base64').toString('utf-8')
	return {
		event,
		isRaw: true,
		// kinesis timestamp is in seconds, not ms
		timestamp: kinesis.approximateArrivalTimestamp * 1000
	}
}

const bailIfErrorNotRetryable = (bail) => (error) => {
	if (!error.retryable) {
		bail(error)
	} else {
		throw error
	}
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
  
		await retry(
			(bail) => cloudWatch.putMetricData(req).promise().catch(bailIfErrorNotRetryable(bail)),
			{
				retries: parseInt(process.env.RETRIES || '5'),
				minTimeout: parseFloat(process.env.RETRY_MIN_TIMEOUT || '1000'),
				maxTimeout: parseFloat(process.env.RETRY_MAX_TIMEOUT || '60000'),
				factor: 2,
				onRetry: (err) => log.warn('retrying publishing CloudWatch metrics...', err)
			})
			.then(() => debug(`sent [${chunk.length}] metrics`))
			.catch(err => log.error(
				`failed to publish [${chunk.length}] metrics, skipped...`, 
				{ request: req },
				err))
	}
}

const extractLogEvents = event => {
	// CloudWatch Logs
	if (event.awslogs) {
		return [parseCWLogEvent(event.awslogs.data)]
	}

	// Kinesis
	if (event.Records && event.Records[0].eventSource === 'aws:kinesis') {
		return event.Records.map(record => {
			try {
				return parseCWLogEvent(record.kinesis.data)
			} catch (error) {
				return parseKinesisEvent(record.kinesis)
			}
		})
	}

	return []
}

const processAll = async (cwLogEvents) => {
	const metrics = _.flatMap(cwLogEvents, logEvent => {
		if (logEvent.isRaw) {
			return Array.from(parseRawLogData([], logEvent))
		}

		// from here on, we know it's a CW log event
		const cwLogEvent = logEvent

		// only Lambda logs are relevant
		if (!cwLogEvent.logGroup.startsWith('/aws/lambda')) {
			return []
		}
    
		// e.g. "/aws/lambda/service-env-funcName"
		const functionName = cwLogEvent.logGroup.split('/').reverse()[0]
    
		// e.g. "2016/08/17/[76]afe5c000d5344c33b5d88be7a4c55816"
		const start = cwLogEvent.logStream.indexOf('[')
		const end = cwLogEvent.logStream.indexOf(']')
		const functionVersion = cwLogEvent.logStream.substring(start+1, end)

		const dimensions = [
			{ Name: 'FunctionName', Value: functionName },
			{ Name: 'FunctionVersion', Value: functionVersion }
		]

		return _.flatMap(
			cwLogEvent.logEvents, 
			evt => Array.from(parseLambdaLogData(dimensions, evt)))
	})
  
	if (!_.isEmpty(metrics)) {
		debug(`publishing ${metrics.length} metrics`)
    
		const groupedByNs = _.groupBy(metrics, 'Namespace')
		for (const namespace of Object.keys(groupedByNs)) {
			const metricDatum = groupedByNs[namespace]
			await publish(namespace, metricDatum)
		}
	}
}

module.exports = {
	extractLogEvents,
	processAll
}
