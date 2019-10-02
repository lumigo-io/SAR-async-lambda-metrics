const _ = require('lodash')
const zlib = require('zlib')
const AWS = require('aws-sdk')

const mockPutMetricData = jest.fn()
AWS.CloudWatch.prototype.putMetricData = mockPutMetricData

console.log = jest.fn()

beforeEach(() => {
	mockPutMetricData.mockReturnValue({
		promise: () => Promise.resolve()
	})
})

afterEach(() => {
	mockPutMetricData.mockReset()
})

test('when invoked by CloudWatch Logs, it should parse and publish metrics', async () => {
	const event = _.cloneDeep(require('../examples/cwlogs.json'))
	const handler = require('./index').handler
	await handler(event)
	expect(mockPutMetricData).toBeCalled()
	const [req] = mockPutMetricData.mock.calls[0]
	expect(req.Namespace).toBe('theburningmonk.com')
	expect(req.MetricData).toHaveLength(2)
  
	req.MetricData.forEach(metricData => {
		expect(metricData.Dimensions).toContainEqual({
			Name: 'FunctionName',
			Value: 'hello-devopsdays'
		})
		expect(metricData.Dimensions).toContainEqual({
			Name: 'FunctionVersion',
			Value: '$LATEST'
		})
		expect(metricData.Dimensions).toContainEqual({
			Name: 'service',
			Value: 'content-item'
		})
		expect(metricData.Dimensions).toContainEqual({
			Name: 'region',
			Value: 'eu-west-1'
		})
	})
})

test('when invoked by Kinesis, it should parse and publish metrics', async () => {
	const event = _.cloneDeep(require('../examples/kinesis.json'))
	const handler = require('./index').handler
	await handler(event)
	expect(mockPutMetricData).toBeCalled()
	const [req] = mockPutMetricData.mock.calls[0]
	expect(req.Namespace).toBe('theburningmonk.com')
	expect(req.MetricData).toHaveLength(2)
  
	req.MetricData.forEach(metricData => {
		expect(metricData.Dimensions).toContainEqual({
			Name: 'FunctionName',
			Value: 'hello-devopsdays'
		})
		expect(metricData.Dimensions).toContainEqual({
			Name: 'FunctionVersion',
			Value: '$LATEST'
		})
		expect(metricData.Dimensions).toContainEqual({
			Name: 'service',
			Value: 'content-item'
		})
		expect(metricData.Dimensions).toContainEqual({
			Name: 'region',
			Value: 'eu-west-1'
		})
	})
})

test('when invoked by another event source, it should be ignored', async () => {
	const event = _.cloneDeep(require('../examples/firehose.json'))
	const handler = require('./index').handler
	await handler(event)
	expect(mockPutMetricData).not.toBeCalled()
})

test('when the log group is not a Lambda function, it should be ignored', async () => {
	const rawEvent = _.cloneDeep(require('../examples/cwlogs.plain.json'))
	rawEvent.logGroup = 'API-Gateway-Execution-Logs_123456789'
	const event = genCwLogsEvent(rawEvent)
	const handler = require('./index').handler  
	await handler(event)
	expect(mockPutMetricData).not.toBeCalled()
})

test('when the message is not in the right format, it should be ignored', async () => {
	const rawEvent = _.cloneDeep(require('../examples/cwlogs.plain.json'))
	rawEvent.logEvents = [{
		id: '34874920119968482746143972702572472247946445098052747264',
		timestamp: 1563845504242,
		message: '2019-07-23T01:31:44.241Z\t63cdfa76-f4f8-4ee8-a2f3-dc189533753d\tINFO\tMONITORING YO!\n',
		extractedFields: {
			event: 'INFO\tMONITORING YO!\n',
			request_id: '63cdfa76-f4f8-4ee8-a2f3-dc189533753d',
			timestamp: '2019-07-23T01:31:44.241Z'
		}
	}]
	const event = genCwLogsEvent(rawEvent)
	const handler = require('./index').handler  
	await handler(event)
	expect(mockPutMetricData).not.toBeCalled()
})

test('when the message is from Python, it should parse and publish', async () => {
	const rawEvent = _.cloneDeep(require('../examples/cwlogs.python.plain.json'))
	const event = genCwLogsEvent(rawEvent)
	const handler = require('./index').handler  
	await handler(event)
	expect(mockPutMetricData).toBeCalled()
	const [req] = mockPutMetricData.mock.calls[0]
	expect(req.Namespace).toBe('theburningmonk.com')
	expect(req.MetricData).toHaveLength(1)
  
	req.MetricData.forEach(metricData => {
		expect(metricData.Dimensions).toContainEqual({
			Name: 'FunctionName',
			Value: 'python-test'
		})
		expect(metricData.Dimensions).toContainEqual({
			Name: 'FunctionVersion',
			Value: '76'
		})
		expect(metricData.Dimensions).toContainEqual({
			Name: 'service',
			Value: 'content-item'
		})
		expect(metricData.Dimensions).toContainEqual({
			Name: 'region',
			Value: 'eu-west-1'
		})
	})
})

test('when the message is published to Kinesis from EC2, it should parse and publish', async () => {
	const event = _.cloneDeep(require('../examples/kinesis.ec2.plain.json'))
	const handler = require('./index').handler  
	await handler(event)
	expect(mockPutMetricData).toBeCalled()
	const [req] = mockPutMetricData.mock.calls[0]
	expect(req.Namespace).toBe('theburningmonk.com')
	expect(req.MetricData).toHaveLength(1)
	expect(req.MetricData[0].Timestamp).toBe('2019-09-09T22:58:31.564Z')
  
	req.MetricData.forEach(metricData => {		
		expect(metricData.Dimensions).toContainEqual({
			Name: 'service',
			Value: 'content-item'
		})
		expect(metricData.Dimensions).toContainEqual({
			Name: 'region',
			Value: 'eu-west-1'
		})
	})
})

describe('when RECORD_LAMBDA_USAGE_METRICS is enabled', () => {
	beforeEach(() => {
		process.env.RECORD_LAMBDA_USAGE_METRICS = 'true'
	})

	test('usage metrics are published', async () => {
		const rawEvent = _.cloneDeep(require('../examples/cwlogs.plain.json'))
		rawEvent.logEvents = [{
			id: '34874920119968482746143972702572472247946445098052747264',
			timestamp: 1563845504242,
			message: 'REPORT RequestId:\tf631edda-b729-4c80-bfe2-47587a314e7c\tDuration: 10.74 ms\tBilled Duration: 100 ms\tMemory Size: 128 MB\tMax Memory Used: 56 MB\tInit Duration: 118.64 ms\n',
			extractedFields: {
			}
		}]
		const event = genCwLogsEvent(rawEvent)
		const handler = require('./index').handler  
		await handler(event)
		expect(mockPutMetricData).toBeCalled()
		const [req] = mockPutMetricData.mock.calls[0]
		expect(req.Namespace).toBe('AWS/Lambda')
		expect(req.MetricData).toHaveLength(3)
    
		req.MetricData.forEach(metricData => {
			expect(metricData.Dimensions).toContainEqual({
				Name: 'FunctionName',
				Value: 'hello-devopsdays'
			})
			expect(metricData.Dimensions).toContainEqual({
				Name: 'FunctionVersion',
				Value: '$LATEST'
			})
		})
    
		const billedDuration = req.MetricData.find(x => x.MetricName === 'BilledDuration')
		expect(billedDuration.Unit).toBe('Milliseconds')
		expect(billedDuration.Value).toBe(100)
    
		const memorySize = req.MetricData.find(x => x.MetricName === 'MemorySize')
		expect(memorySize.Unit).toBe('Megabytes')
		expect(memorySize.Value).toBe(128)
    
		const memoryUsed = req.MetricData.find(x => x.MetricName === 'MemoryUsed')
		expect(memoryUsed.Unit).toBe('Megabytes')
		expect(memoryUsed.Value).toBe(56)
	})
})

describe('when RECORD_LAMBDA_USAGE_METRICS is disabled', () => {
	beforeEach(() => {
		process.env.RECORD_LAMBDA_USAGE_METRICS = 'false'
	})

	test('lambda usage metrics are ignored', async () => {
		const rawEvent = _.cloneDeep(require('../examples/cwlogs.plain.json'))
		rawEvent.logEvents = [{
			id: '34874920119968482746143972702572472247946445098052747264',
			timestamp: 1563845504242,
			message: 'REPORT RequestId: f631edda-b729-4c80-bfe2-47587a314e7c Duration: 10.74 ms Billed Duration: 100 ms Memory Size: 128 MB Max Memory Used: 56 MB Init Duration: 118.64 ms\n',
			extractedFields: {
			}
		}]
		const event = genCwLogsEvent(rawEvent)
		const handler = require('./index').handler  
		await handler(event)
		expect(mockPutMetricData).not.toBeCalled()
	})
})

describe('when RECORD_LAMBDA_USAGE_METRICS is not set', () => {
	beforeEach(() => {
		delete process.env.RECORD_LAMBDA_USAGE_METRICS
	})

	test('lambda usage metrics are ignored', async () => {
		const rawEvent = _.cloneDeep(require('../examples/cwlogs.plain.json'))
		rawEvent.logEvents = [{
			id: '34874920119968482746143972702572472247946445098052747264',
			timestamp: 1563845504242,
			message: 'REPORT RequestId: f631edda-b729-4c80-bfe2-47587a314e7c Duration: 10.74 ms Billed Duration: 100 ms Memory Size: 128 MB Max Memory Used: 56 MB Init Duration: 118.64 ms\n',
			extractedFields: {
			}
		}]
		const event = genCwLogsEvent(rawEvent)
		const handler = require('./index').handler  
		await handler(event)
		expect(mockPutMetricData).not.toBeCalled()
	})
})

describe('when RECORD_LAMBDA_COST_METRIC is enabled', () => {
	beforeEach(() => {
		process.env.RECORD_LAMBDA_COST_METRIC = 'true'
	})

	test('cost metric is published', async () => {
		const rawEvent = _.cloneDeep(require('../examples/cwlogs.plain.json'))
		rawEvent.logEvents = [{
			id: '34874920119968482746143972702572472247946445098052747264',
			timestamp: 1563845504242,
			message: 'REPORT RequestId:\tf631edda-b729-4c80-bfe2-47587a314e7c\tDuration: 10.74 ms\tBilled Duration: 100 ms\tMemory Size: 128 MB\tMax Memory Used: 56 MB\tInit Duration: 118.64 ms\n',
			extractedFields: {
			}
		}]
		const event = genCwLogsEvent(rawEvent)
		const handler = require('./index').handler  
		await handler(event)
		expect(mockPutMetricData).toBeCalled()
		const [req] = mockPutMetricData.mock.calls[0]
		expect(req.Namespace).toBe('AWS/Lambda')
		expect(req.MetricData).toHaveLength(1)
    
		req.MetricData.forEach(metricData => {
			expect(metricData.Dimensions).toContainEqual({
				Name: 'FunctionName',
				Value: 'hello-devopsdays'
			})
			expect(metricData.Dimensions).toContainEqual({
				Name: 'FunctionVersion',
				Value: '$LATEST'
			})
			expect(metricData.Unit).toBe('None')
			expect(metricData.Value).toBe(0.000000208)
		})
	})
})

describe('when RECORD_LAMBDA_COST_METRIC is disabled', () => {
	beforeEach(() => {
		process.env.RECORD_LAMBDA_COST_METRIC = 'false'
	})

	test('cost metric is not published', async () => {
		const rawEvent = _.cloneDeep(require('../examples/cwlogs.plain.json'))
		rawEvent.logEvents = [{
			id: '34874920119968482746143972702572472247946445098052747264',
			timestamp: 1563845504242,
			message: 'REPORT RequestId:\tf631edda-b729-4c80-bfe2-47587a314e7c\tDuration: 10.74 ms\tBilled Duration: 100 ms\tMemory Size: 128 MB\tMax Memory Used: 56 MB\tInit Duration: 118.64 ms\n',
			extractedFields: {
			}
		}]
		const event = genCwLogsEvent(rawEvent)
		const handler = require('./index').handler  
		await handler(event)
		expect(mockPutMetricData).not.toBeCalled()
	})
})

describe('when RECORD_LAMBDA_COST_METRIC is not set', () => {
	beforeEach(() => {
		delete process.env.RECORD_LAMBDA_COST_METRIC
	})

	test('cost metric is not published', async () => {
		const rawEvent = _.cloneDeep(require('../examples/cwlogs.plain.json'))
		rawEvent.logEvents = [{
			id: '34874920119968482746143972702572472247946445098052747264',
			timestamp: 1563845504242,
			message: 'REPORT RequestId:\tf631edda-b729-4c80-bfe2-47587a314e7c\tDuration: 10.74 ms\tBilled Duration: 100 ms\tMemory Size: 128 MB\tMax Memory Used: 56 MB\tInit Duration: 118.64 ms\n',
			extractedFields: {
			}
		}]
		const event = genCwLogsEvent(rawEvent)
		const handler = require('./index').handler  
		await handler(event)
		expect(mockPutMetricData).not.toBeCalled()
	})
})

describe('when RECORD_LAMBDA_COLD_START_METRIC is enabled', () => {
	beforeEach(() => {
		process.env.RECORD_LAMBDA_COLD_START_METRIC = 'true'
	})

	test('init duration metric is published', async () => {
		const rawEvent = _.cloneDeep(require('../examples/cwlogs.plain.json'))
		rawEvent.logEvents = [{
			id: '34874920119968482746143972702572472247946445098052747264',
			timestamp: 1563845504242,
			message: 'REPORT RequestId:\tf631edda-b729-4c80-bfe2-47587a314e7c\tDuration: 10.74 ms\tBilled Duration: 100 ms\tMemory Size: 128 MB\tMax Memory Used: 56 MB\tInit Duration: 118.64 ms\n',
			extractedFields: {
			}
		}]
		const event = genCwLogsEvent(rawEvent)
		const handler = require('./index').handler  
		await handler(event)
		expect(mockPutMetricData).toBeCalled()
		const [req] = mockPutMetricData.mock.calls[0]
		expect(req.Namespace).toBe('AWS/Lambda')
		expect(req.MetricData).toHaveLength(1)
    
		req.MetricData.forEach(metricData => {
			expect(metricData.Dimensions).toContainEqual({
				Name: 'FunctionName',
				Value: 'hello-devopsdays'
			})
			expect(metricData.Dimensions).toContainEqual({
				Name: 'FunctionVersion',
				Value: '$LATEST'
			})
			expect(metricData.Unit).toBe('Milliseconds')
			expect(metricData.Value).toBe(118.64)
		})
	})

	test('non-cold start messages are ignored', async () => {
		const rawEvent = _.cloneDeep(require('../examples/cwlogs.plain.json'))
		rawEvent.logEvents = [{
			id: '34874920119968482746143972702572472247946445098052747264',
			timestamp: 1563845504242,
			message: 'REPORT RequestId:\tf631edda-b729-4c80-bfe2-47587a314e7c\tDuration: 10.74 ms\tBilled Duration: 100 ms\tMemory Size: 128 MB\tMax Memory Used: 56 MB\t\n',
			extractedFields: {
			}
		}]
		const event = genCwLogsEvent(rawEvent)
		const handler = require('./index').handler  
		await handler(event)
		expect(mockPutMetricData).not.toBeCalled()
	})
})

describe('when RECORD_LAMBDA_COLD_START_METRIC is disabled', () => {
	beforeEach(() => {
		process.env.RECORD_LAMBDA_COLD_START_METRIC = 'false'
	})

	test('cold start metric is not published', async () => {
		const rawEvent = _.cloneDeep(require('../examples/cwlogs.plain.json'))
		rawEvent.logEvents = [{
			id: '34874920119968482746143972702572472247946445098052747264',
			timestamp: 1563845504242,
			message: 'REPORT RequestId:\tf631edda-b729-4c80-bfe2-47587a314e7c\tDuration: 10.74 ms\tBilled Duration: 100 ms\tMemory Size: 128 MB\tMax Memory Used: 56 MB\tInit Duration: 118.64 ms\n',
			extractedFields: {
			}
		}]
		const event = genCwLogsEvent(rawEvent)
		const handler = require('./index').handler  
		await handler(event)
		expect(mockPutMetricData).not.toBeCalled()
	})
})

describe('when RECORD_LAMBDA_COLD_START_METRIC is not set', () => {
	beforeEach(() => {
		delete process.env.RECORD_LAMBDA_COLD_START_METRIC
	})

	test('cold start metric is not published', async () => {
		const rawEvent = _.cloneDeep(require('../examples/cwlogs.plain.json'))
		rawEvent.logEvents = [{
			id: '34874920119968482746143972702572472247946445098052747264',
			timestamp: 1563845504242,
			message: 'REPORT RequestId:\tf631edda-b729-4c80-bfe2-47587a314e7c\tDuration: 10.74 ms\tBilled Duration: 100 ms\tMemory Size: 128 MB\tMax Memory Used: 56 MB\tInit Duration: 118.64 ms\n',
			extractedFields: {
			}
		}]
		const event = genCwLogsEvent(rawEvent)
		const handler = require('./index').handler  
		await handler(event)
		expect(mockPutMetricData).not.toBeCalled()
	})
})

describe('error handling', () => {
	beforeEach(() => mockPutMetricData.mockReset())
  
	test('should retry retryable errors when publishing CloudWatch metrics', async () => {
		givenPutMetricDataFailsWith('ThrottlingException', 'Rate exceeded')
		givenPutMetricDataSucceeds()
    
		const event = _.cloneDeep(require('../examples/cwlogs.json'))
		const handler = require('./index').handler
		await expect(handler(event)).resolves.toEqual(undefined)
		expect(mockPutMetricData).toBeCalledTimes(2)
	})
  
	test('should not retry non-retryable errors when publishing CloudWatch metrics', async () => {
		givenPutMetricDataFailsWith('Foo', 'Bar', false)
    
		const event = _.cloneDeep(require('../examples/cwlogs.json'))
		const handler = require('./index').handler
		await expect(handler(event)).resolves.toEqual(undefined)
		expect(mockPutMetricData).toBeCalledTimes(1)
	})
})

const givenPutMetricDataFailsWith = (code, message, retryable = true) => {
	mockPutMetricData.mockReturnValueOnce({
		promise: () => Promise.reject(new AwsError(code, message, retryable))
	})
}

const givenPutMetricDataSucceeds = () => {
	mockPutMetricData.mockReturnValueOnce({
		promise: () => Promise.resolve()
	})
}

const genCwLogsEvent = (payload) => {
	const json = JSON.stringify(payload)
	const data = zlib.gzipSync(Buffer.from(json, 'utf8')).toString('base64')
	return {
		awslogs: {
			data
		}
	}
}

class AwsError extends Error {
	constructor (code, message, retryable) {
		super(message)

		this.code = code
		this.retryable = retryable
	}
}
