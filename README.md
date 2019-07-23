# SAR-async-lambda-metrics

[![CircleCI](https://circleci.com/gh/theburningmonk/SAR-async-lambda-metrics.svg?style=svg)](https://circleci.com/gh/theburningmonk/SAR-async-lambda-metrics) [![Greenkeeper badge](https://badges.greenkeeper.io/theburningmonk/SAR-async-lambda-metrics.svg)](https://greenkeeper.io/)

A Serverless application that parses custom metrics from CloudWatch Logs and sends them to CloudWatch as custom metrics.

## Deploying to your account (via the console)

Go to this [page](https://serverlessrepo.aws.amazon.com/applications/arn:aws:serverlessrepo:us-east-1:374852340823:applications~async-custom-metrics) and click the `Deploy` button.

## Deploying via SAM/Serverless framework/CloudFormation

To deploy this via SAM, you need something like this in the CloudFormation template:

```yml
AutoDeployMyAwesomeLambdaLayer:
  Type: AWS::Serverless::Application
  Properties:
    Location:
      ApplicationId: arn:aws:serverlessrepo:us-east-1:374852340823:applications/async-custom-metrics
      SemanticVersion: <enter latest version>
    Parameters:
      EventSourceType: <Lambda or Kinesis>
      TimeoutSeconds: <defaults to 300>
      KinesisStreamArn: <ARN for the Kinesis stream if EventSourceType is Kinesis>
      KinesisStreamBatchSize: <defaults to 100>
```

To do the same via CloudFormation or the Serverless framework, you need to first add the following `Transform`:

```yml
Transform: AWS::Serverless-2016-10-31
```

For more details, read this [post](https://theburningmonk.com/2019/05/how-to-include-serverless-repository-apps-in-serverless-yml/).

## Parameters

`EventSourceType`: What's the event source you will intend to use? If logs are pushed from CloudWatch Logs to Lambda directly, then use `Lambda`. If logs are pushed to a Kinesis Stream first, then use `Kinesis`. Other event sources are not supported (yet).

`TimeoutSeconds`: (optional) Timeout for the Lambda function that would ship metrics to CloudWatch. Defaults to 30s.

`KinesisStreamArn`: (optional) Only relevant to the Kinesis event source type. The ARN to the Kinesis stream to subscribe the function to.

`KinesisStreamBatchSize`: (optional) Only relevant to the Kinesis event source type. The batch size to use for the subscription.
