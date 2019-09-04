const zlib = require('zlib')

const mockPutMetricData = jest.fn()
jest.mock('aws-sdk', () => {
	return {
		CloudWatch: jest.fn(() => ({
			putMetricData: mockPutMetricData
		}))
	}
})

beforeEach(() => {
	mockPutMetricData.mockReset()
	mockPutMetricData.mockReturnValue({
		promise: () => Promise.resolve()
	})
})

test('when invoked by CloudWatch Logs, it should parse and publish metrics', async () => {
	const event = require('../examples/cwlogs.json')
	const handler = require('./index').handler
	await handler(event)
	expect(mockPutMetricData).toBeCalled()
	const [req] = mockPutMetricData.mock.calls[0]
	expect(req.Namespace).toBe('theburningmonk.com')
	expect(req.MetricData).toHaveLength(2)
})

test('when invoked by Kinesis, it should parse and publish metrics', async () => {
	const event = require('../examples/kinesis.json')
	const handler = require('./index').handler
	await handler(event)
	expect(mockPutMetricData).toBeCalled()
	const [req] = mockPutMetricData.mock.calls[0]
	expect(req.Namespace).toBe('theburningmonk.com')
	expect(req.MetricData).toHaveLength(2)
})

test('when invoked by another event source, it should be ignored', async () => {
	const event = require('../examples/firehose.json')
	const handler = require('./index').handler
	await handler(event)
	expect(mockPutMetricData).not.toBeCalled()
})

test('when the log group is not a Lambda function, it should be ignored', async () => {
	const rawEvent = require('../examples/cwlogs.plain.json')
	rawEvent.logGroup = 'API-Gateway-Execution-Logs_123456789'
	const event = genCwLogsEvent(rawEvent)
	const handler = require('./index').handler  
	await handler(event)
	expect(mockPutMetricData).not.toBeCalled()
})

test('when the message is not in the right format, it should be ignored', async () => {
	const rawEvent = require('../examples/cwlogs.plain.json')
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
	const rawEvent = require('../examples/cwlogs.python.plain.json')
	const event = genCwLogsEvent(rawEvent)
	const handler = require('./index').handler  
	await handler(event)
	expect(mockPutMetricData).toBeCalled()
	const [req] = mockPutMetricData.mock.calls[0]
	expect(req.Namespace).toBe('theburningmonk.com')
	expect(req.MetricData).toHaveLength(1)
})

function genCwLogsEvent(payload) {
	const json = JSON.stringify(payload)
	const data = zlib.gzipSync(Buffer.from(json, 'utf8')).toString('base64')
	return {
		awslogs: {
			data
		}
	}
}
