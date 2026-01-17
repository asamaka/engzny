#!/bin/bash

# API Test Script for thinx.fun
# This script tests the image analysis API endpoints

# Configuration
BASE_URL="${1:-http://localhost:3000}"
TEST_IMAGE_DIR="$(dirname "$0")/../test-images"

echo "==================================="
echo "thinx.fun API Test Suite"
echo "Base URL: $BASE_URL"
echo "==================================="
echo ""

# Test 1: Health Check
echo "Test 1: Health Check Endpoint"
echo "-----------------------------"
HEALTH_RESPONSE=$(curl -s "$BASE_URL/api/health")
echo "Response: $HEALTH_RESPONSE"
if echo "$HEALTH_RESPONSE" | grep -q '"status":"ok"'; then
    echo "PASS: Health check successful"
else
    echo "FAIL: Health check failed"
fi
echo ""

# Test 2: Upload endpoint without image (should fail)
echo "Test 2: Upload without image (expect error)"
echo "--------------------------------------------"
NO_IMAGE_RESPONSE=$(curl -s -X POST "$BASE_URL/api/upload")
echo "Response: $NO_IMAGE_RESPONSE"
if echo "$NO_IMAGE_RESPONSE" | grep -q '"error"'; then
    echo "PASS: Correctly returned error for missing image"
else
    echo "FAIL: Should have returned error"
fi
echo ""

# Test 3: Upload with test image
echo "Test 3: Upload test image via API"
echo "----------------------------------"
if [ -f "$TEST_IMAGE_DIR/test-gradient.png" ]; then
    UPLOAD_RESPONSE=$(curl -s -X POST "$BASE_URL/api/upload" \
        -F "image=@$TEST_IMAGE_DIR/test-gradient.png" \
        -F "question=What colors do you see in this image?")
    echo "Response: $UPLOAD_RESPONSE"
    
    # Extract job ID
    JOB_ID=$(echo "$UPLOAD_RESPONSE" | grep -o '"jobId":"[^"]*"' | cut -d'"' -f4)
    
    if [ -n "$JOB_ID" ]; then
        echo "PASS: Upload successful, Job ID: $JOB_ID"
        
        # Test 4: Check job status
        echo ""
        echo "Test 4: Check job status"
        echo "------------------------"
        echo "Waiting for job to process..."
        
        for i in {1..30}; do
            sleep 2
            STATUS_RESPONSE=$(curl -s "$BASE_URL/api/job/$JOB_ID/status")
            STATUS=$(echo "$STATUS_RESPONSE" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
            PROGRESS=$(echo "$STATUS_RESPONSE" | grep -o '"progress":[0-9]*' | cut -d':' -f2)
            
            echo "  Poll $i: Status=$STATUS, Progress=$PROGRESS%"
            
            if [ "$STATUS" = "completed" ]; then
                echo "PASS: Job completed successfully"
                echo ""
                echo "Analysis Result:"
                echo "$STATUS_RESPONSE" | grep -o '"analysis":"[^"]*"' | cut -d'"' -f4 | head -c 500
                echo "..."
                break
            elif [ "$STATUS" = "failed" ]; then
                echo "WARN: Job failed (may be due to API key or rate limits)"
                ERROR=$(echo "$STATUS_RESPONSE" | grep -o '"error":"[^"]*"' | cut -d'"' -f4)
                echo "Error: $ERROR"
                break
            fi
        done
    else
        echo "FAIL: Could not extract job ID"
    fi
else
    echo "SKIP: Test image not found at $TEST_IMAGE_DIR/test-gradient.png"
fi
echo ""

# Test 5: Check non-existent job
echo "Test 5: Check non-existent job (expect 404)"
echo "--------------------------------------------"
FAKE_JOB_RESPONSE=$(curl -s "$BASE_URL/api/job/00000000-0000-0000-0000-000000000000/status")
echo "Response: $FAKE_JOB_RESPONSE"
if echo "$FAKE_JOB_RESPONSE" | grep -q '"error":"Job not found"'; then
    echo "PASS: Correctly returned 404 for non-existent job"
else
    echo "FAIL: Should have returned job not found error"
fi
echo ""

# Test 6: List jobs endpoint
echo "Test 6: List all jobs"
echo "---------------------"
JOBS_RESPONSE=$(curl -s "$BASE_URL/api/jobs")
echo "Response: $JOBS_RESPONSE"
if echo "$JOBS_RESPONSE" | grep -q '"jobs"'; then
    echo "PASS: Jobs list endpoint working"
else
    echo "FAIL: Jobs list endpoint not working"
fi
echo ""

# Test 7: Direct analyze endpoint (original functionality)
echo "Test 7: Direct analyze endpoint (original UI flow)"
echo "---------------------------------------------------"
if [ -f "$TEST_IMAGE_DIR/test-gradient.png" ]; then
    ANALYZE_RESPONSE=$(curl -s -X POST "$BASE_URL/api/analyze" \
        -F "image=@$TEST_IMAGE_DIR/test-gradient.png")
    
    if echo "$ANALYZE_RESPONSE" | grep -q '"success":true'; then
        echo "PASS: Direct analyze endpoint working"
    elif echo "$ANALYZE_RESPONSE" | grep -q '"error"'; then
        echo "WARN: Direct analyze returned error (may be due to API key)"
        echo "Response: $ANALYZE_RESPONSE"
    else
        echo "FAIL: Unexpected response"
        echo "Response: $ANALYZE_RESPONSE"
    fi
else
    echo "SKIP: Test image not found"
fi
echo ""

# Test 8: Job progress page loads
echo "Test 8: Job progress page (HTML)"
echo "---------------------------------"
PAGE_RESPONSE=$(curl -s "$BASE_URL/12345678-1234-1234-1234-123456789012" | head -5)
if echo "$PAGE_RESPONSE" | grep -q "<!DOCTYPE html>"; then
    echo "PASS: Job progress page loads HTML"
else
    echo "FAIL: Job progress page not loading correctly"
fi
echo ""

echo "==================================="
echo "Test Suite Complete"
echo "==================================="
