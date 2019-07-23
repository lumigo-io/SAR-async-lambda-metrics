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
